import { canonicalJsonKey, hasUnsafeJsonObjectKeys, parseJsonWithoutDuplicateKeys, TYPE_SCHEMAS, walk } from "./runtime.js";
import { containsHighConfidenceSensitivePayload } from "./sensitive-payload.js";
import { isExplicitPrivateEndpointHost, isUnsafeNetworkHost } from "./url-security.js";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const DEFAULT_MAX_ENHANCEMENT_CHARS = 12000;
const INTERNAL_TEXT_TERMS = /RAGFlow|fallback|兜底|本地模板|compiled_prompt|final_prompt|internal_prompt|provider_internal_payload|provider_payload|raw_provider|b64_json|data:image|data_url/i;
const INTERNAL_KEY_TERMS = /RAGFlow|fallback|兜底|本地模板|compiled_prompt|final_prompt|internal_prompt|provider_internal_payload|provider_payload|raw_provider|Authorization|Cookie|Bearer|token|secret|api[_-]?key|base64|b64_json|data:image|data_url/i;
const BINDING_DECISION_TERMS = /primary|auxiliary|main\s*reference|secondary\s*reference|weight(?:ed|ing)?|priority|主参考|辅参考|主图|辅图|主辅|权重|优先级/i;
const ALLOWED_TOP_LEVEL_FIELDS = new Set(TYPE_SCHEMAS.RagflowEnhancement.fields);
const RAGFLOW_DEPLOYMENT_TIERS = new Set(["production", "staging", "development", "test"]);
const FORBIDDEN_ENHANCEMENT_CANONICAL_KEYS = new Set([
  "__proto__",
  "proto",
  "prototype",
  "constructor",
  "finalprompt",
  "compiledprompt",
  "internalprompt",
  "provider",
  "providerconfig",
  "providerpayload",
  "providerinternalpayload",
  "providerrawpayload",
  "providerrawresponse",
  "rawprovider",
  "rawproviderpayload",
  "rawproviderresponse",
  "apikey",
  "authorization",
  "proxyauthorization",
  "headers",
  "cookie",
  "setcookie",
  "token",
  "accesstoken",
  "secret",
  "clientsecret",
  "password",
  "callback",
  "callbackurl",
  "images",
  "image",
  "imageurl",
  "b64json",
  "base64",
  "imagebase64",
  "dataurl",
  "model",
  "endpoint",
  "baseurl",
  "metadata",
  "options",
  "extra",
  "context",
  "referenceid",
  "referenceids",
  "assetid",
  "assetids",
  "references",
  "referencepolicy",
  "output",
  "enhancement",
  "inputanalysis",
  "storyboardprocessing",
  "templateguidance",
  "referenceweight",
  "bindingdecision"
]);

export async function getRagflowEnhancement({ request, binding, timeoutMs = 6000, fetchImpl = globalThis.fetch, lookupHost = dnsLookup, env = process.env } = {}) {
  const endpoint = String(env.RAGFLOW_ENHANCEMENT_URL || "").trim();
  if (!endpoint) return { enhancement: null, discarded: "not_configured" };
  const deadline = createDeadline(timeoutMs);
  const endpointPolicy = await validateEnhancementEndpoint(endpoint, env, lookupHost, deadline);
  if (!endpointPolicy.ok) return { enhancement: null, discarded: endpointPolicy.discarded };
  if (containsOutboundSensitivePayload({ request, binding })) {
    return { enhancement: null, discarded: "sensitive_input" };
  }

  const controller = new AbortController();
  const remainingMs = deadline.remainingMs();
  if (remainingMs <= 0) return { enhancement: null, discarded: "ragflow_failed" };
  const timer = setTimeout(() => controller.abort(), remainingMs);
  try {
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "manual",
      body: JSON.stringify({
        task_type: request.task_type,
        prompt: request.prompt,
        entity_mentions: binding.entity_mentions,
        resolved_references: binding.references_used,
        output: request.output
      }),
      signal: controller.signal
    };
    const response = fetchImpl === globalThis.fetch
      ? await fetchEnhancementWithPinnedLookup(endpoint, init, endpointPolicy.records, DEFAULT_MAX_ENHANCEMENT_CHARS)
      : await fetchImpl(endpoint, init);
    if (response.status >= 300 && response.status < 400) return { enhancement: null, discarded: "redirect" };
    if (!isJsonResponse(response)) return { enhancement: null, discarded: "non_json" };
    const text = await response.text();
    if (!response.ok) return { enhancement: null, discarded: "ragflow_failed" };
    return validateEnhancement(text, { request, binding });
  } catch {
    return { enhancement: null, discarded: "ragflow_failed" };
  } finally {
    clearTimeout(timer);
  }
}

function containsOutboundSensitivePayload({ request, binding }) {
  const structuredPayload = {
    prompt: request?.prompt || "",
    entity_mentions: binding?.entity_mentions || [],
    resolved_references: binding?.references_used || [],
    output: request?.output || {}
  };
  if (containsHighConfidenceSensitivePayload(JSON.stringify(structuredPayload))) return true;
  return containsSensitiveOutboundString(structuredPayload);
}

function containsSensitiveOutboundString(value) {
  let unsafe = false;
  walk(value, (node) => {
    if (unsafe || typeof node !== "string") return;
    unsafe = containsHighConfidenceSensitivePayload(node);
  });
  return unsafe;
}

function createDeadline(timeoutMs) {
  const expiresAt = Date.now() + timeoutMs;
  return {
    remainingMs() {
      return Math.max(0, expiresAt - Date.now());
    }
  };
}

class RagflowEnhancementLookupTimeoutError extends Error {
  constructor() {
    super("RAGFlow enhancement DNS lookup timed out.");
    this.name = "RagflowEnhancementLookupTimeoutError";
  }
}

async function lookupHostWithDeadline(lookupHost, hostname, options, deadline) {
  const timeoutMs = deadline.remainingMs();
  if (timeoutMs <= 0) throw new RagflowEnhancementLookupTimeoutError();
  const lookupPromise = Promise.resolve().then(() => lookupHost(hostname, options));
  lookupPromise.catch(() => {});
  let timer;
  try {
    return await Promise.race([
      lookupPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RagflowEnhancementLookupTimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function validateEnhancementEndpoint(endpoint, env, lookupHost, deadline) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, discarded: "invalid_endpoint" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, discarded: "invalid_endpoint" };
  if (parsed.username || parsed.password) return { ok: false, discarded: "invalid_endpoint" };
  const tier = normalizeRagflowDeploymentTier(env.RAGFLOW_DEPLOYMENT_TIER);
  if (!tier) return { ok: false, discarded: "invalid_endpoint" };
  const requiresProductionControls = tier === "production" || tier === "staging";
  const allowPrivate = !requiresProductionControls && String(env.RAGFLOW_ALLOW_PRIVATE_ENDPOINTS || "").trim() === "true";
  const allowedOrigins = parseAllowedOrigins(env.RAGFLOW_ALLOWED_ORIGINS);
  if (allowedOrigins.invalid) return { ok: false, discarded: "invalid_endpoint" };
  if (requiresProductionControls && parsed.protocol !== "https:") return { ok: false, discarded: "invalid_endpoint" };
  if (requiresProductionControls && !allowedOrigins.size) return { ok: false, discarded: "invalid_endpoint" };
  if (allowedOrigins.size && !allowedOrigins.has(parsed.origin)) return { ok: false, discarded: "invalid_endpoint" };
  if (requiresProductionControls && isUnsafeNetworkHost(parsed.hostname)) return { ok: false, discarded: "invalid_endpoint" };
  if (isUnsafeNetworkHost(parsed.hostname) && (!allowPrivate || !isExplicitPrivateEndpointHost(parsed.hostname))) {
    return { ok: false, discarded: "invalid_endpoint" };
  }
  if (isIpLiteral(parsed.hostname)) return { ok: true, discarded: "", records: [] };
  let records;
  try {
    records = await lookupHostWithDeadline(lookupHost, parsed.hostname, { all: true, verbatim: true }, deadline);
  } catch {
    return { ok: false, discarded: "invalid_endpoint" };
  }
  if (deadline.remainingMs() <= 0) return { ok: false, discarded: "invalid_endpoint" };
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) return { ok: false, discarded: "invalid_endpoint" };
  for (const record of list) {
    const address = String(record && record.address || "").trim();
    if (!address) return { ok: false, discarded: "invalid_endpoint" };
    if (isUnsafeNetworkHost(address) && (!allowPrivate || !isExplicitPrivateEndpointHost(address))) {
      return { ok: false, discarded: "invalid_endpoint" };
    }
  }
  return {
    ok: true,
    discarded: "",
    records: list.map((record) => ({
      address: String(record.address || "").trim(),
      family: Number(record.family) === 6 ? 6 : 4
    }))
  };
}

function normalizeRagflowDeploymentTier(value) {
  const tier = String(value || "").trim().toLowerCase();
  return RAGFLOW_DEPLOYMENT_TIERS.has(tier) ? tier : "";
}

function parseAllowedOrigins(value) {
  const origins = new Set();
  for (const item of String(value || "").split(",")) {
    const raw = item.trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return nullSet();
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return nullSet();
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function nullSet() {
  const invalid = new Set();
  invalid.invalid = true;
  return invalid;
}

function isIpLiteral(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  return /^(\d{1,3}\.){3}\d{1,3}$/u.test(host) || host.includes(":");
}

function isJsonResponse(response) {
  if (!response || !response.headers || typeof response.headers.get !== "function") return false;
  const contentType = String(response.headers.get("content-type") || "").trim();
  return /^application\/(?:json|[\w.+-]+\+json)\b/i.test(contentType);
}

function fetchEnhancementWithPinnedLookup(url, init, records = [], maxBytes) {
  return new Promise((resolveResponse, rejectResponse) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      rejectResponse(error);
    };
    const clientRequest = transport({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: init.method || "GET",
      headers: init.headers || {},
      signal: init.signal,
      lookup: makePinnedLookup(records)
    }, (incoming) => {
      const chunks = [];
      let total = 0;
      incoming.on("data", (chunk) => {
        const buffer = Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes) {
          const error = new Error("RAGFlow enhancement response exceeded byte limit.");
          error.name = "RagflowEnhancementResponseLimitError";
          incoming.destroy(error);
          clientRequest.destroy(error);
          rejectOnce(error);
          return;
        }
        chunks.push(buffer);
      });
      incoming.on("error", rejectOnce);
      incoming.on("end", () => {
        if (settled) return;
        settled = true;
        const body = Buffer.concat(chunks).toString("utf8");
        resolveResponse({
          ok: Number(incoming.statusCode) >= 200 && Number(incoming.statusCode) < 300,
          status: Number(incoming.statusCode) || 0,
          headers: {
            get: (name) => String(incoming.headers[String(name || "").toLowerCase()] || "")
          },
          text: async () => body
        });
      });
    });
    clientRequest.on("error", rejectOnce);
    clientRequest.end(init.body || "");
  });
}

function makePinnedLookup(records = []) {
  if (!records.length) return undefined;
  return (hostname, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options || {};
    if (opts.all) {
      done(null, records.map((record) => ({
        address: record.address,
        family: record.family
      })));
      return;
    }
    const record = records[0];
    done(null, record.address, record.family);
  };
}

export function validateEnhancement(raw, { request, binding, maxChars = DEFAULT_MAX_ENHANCEMENT_CHARS } = {}) {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > maxChars) return { enhancement: null, discarded: "too_long" };
    const parsed = parseJsonWithoutDuplicateKeys(raw);
    if (!parsed.ok) {
      return { enhancement: null, discarded: "non_json" };
    }
    value = parsed.value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { enhancement: null, discarded: "not_object" };
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) return { enhancement: null, discarded: "too_long" };

  if (containsForbiddenPromptField(value)) return { enhancement: null, discarded: "prompt_leak" };
  if (containsForbiddenIdentifierEmission(value)) return { enhancement: null, discarded: "identifier_emitted" };
  if (containsUrl(value)) return { enhancement: null, discarded: "url_emitted" };
  if (containsBindingDecision(value)) return { enhancement: null, discarded: "binding_decision" };
  if (containsInternalTerms(value)) return { enhancement: null, discarded: "internal_terms" };
  if (containsUnknownTopLevelField(value)) return { enhancement: null, discarded: "unknown_field" };
  if (containsUnsafeEnhancementKey(value)) return { enhancement: null, discarded: "unsafe_key" };
  if (!validStoryboardShape(value)) return { enhancement: null, discarded: "invalid_storyboard_shape" };
  if (!preservesShotList(value, request)) return { enhancement: null, discarded: "shot_plan_changed" };

  return { enhancement: structuredCloneSafe(value), discarded: "" };
}

function containsUnknownTopLevelField(value) {
  return Object.keys(value).some((key) => !ALLOWED_TOP_LEVEL_FIELDS.has(key));
}

function containsUnsafeEnhancementKey(value) {
  if (hasUnsafeJsonObjectKeys(value, FORBIDDEN_ENHANCEMENT_CANONICAL_KEYS)) return true;
  let found = false;
  walk(value, (node) => {
    if (found || !node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      const canonical = canonicalJsonKey(key);
      if (FORBIDDEN_ENHANCEMENT_CANONICAL_KEYS.has(canonical) || INTERNAL_KEY_TERMS.test(key) || BINDING_DECISION_TERMS.test(key)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

function containsForbiddenIdentifierEmission(value) {
  let found = false;
  walk(value, (node) => {
    if (found || !node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (/^(?:reference_ids?|asset_ids?)$/i.test(key)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

function containsUrl(value) {
  return /(?:https?|ftp):\/\/|file:\/\/|data:image/i.test(JSON.stringify(value));
}

function containsInternalTerms(value) {
  let found = false;
  walk(value, (node) => {
    if (found || node == null) return;
    if (typeof node === "string") {
      if (INTERNAL_TEXT_TERMS.test(node) || containsHighConfidenceSensitivePayload(node)) found = true;
      return;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (INTERNAL_KEY_TERMS.test(key)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

function containsBindingDecision(value) {
  let found = false;
  walk(value, (node) => {
    if (found || node == null) return;
    if (typeof node === "string") {
      if (BINDING_DECISION_TERMS.test(node)) found = true;
      return;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (BINDING_DECISION_TERMS.test(key)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

function containsForbiddenPromptField(value) {
  let found = false;
  walk(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (/^(?:final_prompt|compiled_prompt|internal_prompt|provider_payload|provider_internal_payload|raw_provider_payload|raw_provider_response)$/i.test(key)) found = true;
    }
  });
  return found;
}

function validStoryboardShape(value) {
  if ("shot_plan" in value && !Array.isArray(value.shot_plan)) return false;
  if ("normalized_shot_plan" in value && !Array.isArray(value.normalized_shot_plan)) return false;
  return true;
}

function preservesShotList(value, request) {
  if (!Array.isArray(value.normalized_shot_plan)) return true;
  const originalShots = extractShotKeys(request?.prompt || "");
  if (!originalShots.length) return true;
  if (originalShots.length !== value.normalized_shot_plan.length) return false;

  const normalizedKeys = value.normalized_shot_plan.map((item, index) => {
    if (typeof item === "string") {
      const match = item.match(/(?:镜头|shot)\s*([0-9一二三四五六七八九十]+)/i);
      return match ? normalizeShotNumber(match[1]) : String(index + 1);
    }
    if (item && typeof item === "object") {
      return normalizeShotNumber(item.original_order || item.shot_number || item.index || item.order || index + 1);
    }
    return String(index + 1);
  });
  return originalShots.every((key, index) => key === normalizedKeys[index]);
}

export function extractShotKeys(prompt) {
  const keys = [];
  const regex = /(?:^|[\n\r；;])\s*(?:镜头|shot)\s*([0-9一二三四五六七八九十]+)/giu;
  for (const match of String(prompt || "").matchAll(regex)) {
    keys.push(normalizeShotNumber(match[1]));
  }
  return keys;
}

function normalizeShotNumber(value) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const raw = String(value || "").trim();
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return String(map[raw] || raw);
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
