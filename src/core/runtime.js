import { randomBytes, randomUUID, createHash } from "node:crypto";
import { clarification, fail } from "./errors.js";
import { normalizeTextForSensitiveScan } from "./sensitive-payload.js";
import { isUnsafeNetworkHost, normalizePublicHttpUrl } from "./url-security.js";
import {
  ENTITY_TYPE_ALIASES,
  ROLE_ALIASES,
  VALID_ASPECT_RATIOS,
  VALID_ENTITY_TYPES,
  VALID_OUTPUT_LANGUAGES,
  VALID_OUTPUT_QUALITIES,
  VALID_REFERENCE_ROLES,
  VALID_TASK_TYPES
} from "./labels.js";

export const TYPE_SCHEMAS = Object.freeze({
  ImageGenerationRequest: {
    fields: ["request_id", "task_type", "prompt", "references", "reference_policy", "output", "options", "callback_url", "callback"]
  },
  PromptOptimizationRequest: {
    fields: ["request_id", "task_type", "prompt", "references", "reference_policy"]
  },
  ImageGenerationResponse: {
    fields: ["status", "images", "warnings"]
  },
  ReferenceInput: {
    fields: ["reference_id", "entity_name", "entity_type", "role", "url", "mime_type", "display_name", "description", "order"]
  },
  EntityMention: {
    fields: ["mention_id", "marker", "entity_name", "reference_status", "matched_reference_ids"]
  },
  ResolvedReference: {
    fields: ["reference_id", "entity_name", "entity_type", "role", "role_label", "url", "order"]
  },
  ReferencePolicy: {
    fields: ["unbound_entity"]
  },
  GenerationImage: {
    fields: ["url"]
  },
  ProviderAdapterResult: {
    fields: ["status", "images"]
  },
  RagflowEnhancement: {
    fields: ["scene_summary", "visual_focus", "story_function", "action_stages", "shot_plan", "normalized_shot_plan", "lighting_notes", "composition_notes", "negative_notes", "missing_constraints"]
  }
});

export const FORBIDDEN_PUBLIC_FIELDS = Object.freeze([
  "final_prompt",
  "final_prompt_preview",
  "compiled_prompt",
  "enhancement",
  "input_analysis",
  "storyboard_processing",
  "storyboard_path",
  "provider_internal_payload",
  "provider_raw_payload",
  "provider_raw_response",
  "provider_payload",
  "provider_response",
  "raw_provider_payload",
  "raw_provider_response",
  "base64",
  "b64_json",
  "binary",
  "callback_status",
  "ragflow_status",
  "RAGFlow_status",
  "ragflow_state",
  "fallback",
  "fallback_status"
]);

export function makeId(prefix) {
  const suffix = typeof randomUUID === "function"
    ? randomUUID().replaceAll("-", "").slice(0, 18)
    : randomBytes(12).toString("hex");
  return `${prefix}_${suffix}`;
}

export function stringValue(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function canonicalJsonKey(key) {
  return normalizeTextForSensitiveScan(key)
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
}

export function parseJsonWithoutDuplicateKeys(text) {
  const source = stringValue(text);
  try {
    const result = scanJsonValue(source, skipJsonWhitespace(source, 0));
    const end = skipJsonWhitespace(source, result.index);
    if (end !== source.length) return { ok: false, value: null, duplicate: false };
  } catch (error) {
    return {
      ok: false,
      value: null,
      duplicate: error && error.name === "DuplicateJsonKeyError"
    };
  }
  try {
    return { ok: true, value: JSON.parse(source), duplicate: false };
  } catch {
    return { ok: false, value: null, duplicate: false };
  }
}

export function hasUnsafeJsonObjectKeys(value, forbiddenCanonicalKeys = []) {
  const forbidden = new Set([...forbiddenCanonicalKeys].map(canonicalJsonKey));
  let unsafe = false;
  const visit = (node) => {
    if (unsafe || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (Object.getPrototypeOf(node) !== Object.prototype) {
      unsafe = true;
      return;
    }
    const seen = new Set();
    for (const key of Object.keys(node)) {
      const canonical = canonicalJsonKey(key);
      if (seen.has(canonical) || forbidden.has(canonical)) {
        unsafe = true;
        return;
      }
      seen.add(canonical);
      visit(node[key]);
    }
  };
  visit(value);
  return unsafe;
}

function scanJsonValue(text, index) {
  const start = skipJsonWhitespace(text, index);
  const char = text[start];
  if (char === "{") return scanJsonObject(text, start);
  if (char === "[") return scanJsonArray(text, start);
  if (char === "\"") {
    const token = parseJsonStringToken(text, start);
    return { index: token.index };
  }
  const match = text.slice(start).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u);
  if (!match) throw new Error("invalid json token");
  return { index: start + match[0].length };
}

function scanJsonObject(text, index) {
  const seen = new Set();
  let cursor = skipJsonWhitespace(text, index + 1);
  if (text[cursor] === "}") return { index: cursor + 1 };
  while (cursor < text.length) {
    const token = parseJsonStringToken(text, cursor);
    const canonical = canonicalJsonKey(token.value);
    if (seen.has(canonical)) {
      const error = new Error("duplicate json key");
      error.name = "DuplicateJsonKeyError";
      throw error;
    }
    seen.add(canonical);
    cursor = skipJsonWhitespace(text, token.index);
    if (text[cursor] !== ":") throw new Error("invalid json object");
    const value = scanJsonValue(text, cursor + 1);
    cursor = skipJsonWhitespace(text, value.index);
    if (text[cursor] === "}") return { index: cursor + 1 };
    if (text[cursor] !== ",") throw new Error("invalid json object");
    cursor = skipJsonWhitespace(text, cursor + 1);
  }
  throw new Error("invalid json object");
}

function scanJsonArray(text, index) {
  let cursor = skipJsonWhitespace(text, index + 1);
  if (text[cursor] === "]") return { index: cursor + 1 };
  while (cursor < text.length) {
    const value = scanJsonValue(text, cursor);
    cursor = skipJsonWhitespace(text, value.index);
    if (text[cursor] === "]") return { index: cursor + 1 };
    if (text[cursor] !== ",") throw new Error("invalid json array");
    cursor = skipJsonWhitespace(text, cursor + 1);
  }
  throw new Error("invalid json array");
}

function parseJsonStringToken(text, index) {
  if (text[index] !== "\"") throw new Error("invalid json string");
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "\"") {
      const raw = text.slice(index, cursor + 1);
      return { value: JSON.parse(raw), index: cursor + 1 };
    }
    cursor += 1;
  }
  throw new Error("invalid json string");
}

function skipJsonWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
  return cursor;
}

export function intRange(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

export function sha256Short(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex").slice(0, 16);
}

export function normalizeRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("INVALID_REQUEST_SCHEMA", "请求体必须是 JSON 对象。");
  }

  const taskType = stringValue(body.task_type).trim();
  if (!taskType || !VALID_TASK_TYPES.includes(taskType)) {
    clarification("UNSUPPORTED_TASK_TYPE", "不支持的 task_type。");
  }

  const prompt = stringValue(body.prompt).trim();
  if (!prompt) {
    clarification("PROMPT_REQUIRED", "prompt 不能为空。");
  }

  const references = Array.isArray(body.references) ? body.references.map((item, index) => normalizeReference(item, index)) : [];
  if (body.references != null && !Array.isArray(body.references)) {
    fail("INVALID_REQUEST_SCHEMA", "references 必须是数组。");
  }

  const referencePolicy = normalizeReferencePolicy(body.reference_policy);
  const output = normalizeOutput(body.output);
  const options = body.options && typeof body.options === "object" && !Array.isArray(body.options) ? { ...body.options } : {};
  const callbackUrl = normalizeCallbackUrl(body);
  const requestId = stringValue(body.request_id).trim() || makeId("req");

  return {
    request_id: requestId,
    task_type: taskType,
    prompt,
    references,
    reference_policy: referencePolicy,
    output,
    options,
    callback_url: callbackUrl,
    generation_mode: references.length ? "image_to_image" : "text_to_image"
  };
}

export function assertReferenceUrlAllowed(value, field = "reference.url") {
  if (isLocalGeneratedImageStoreReferenceUrl(value)) {
    return normalizePublicHttpUrl(value, field, { allowLocal: true });
  }
  return normalizePublicHttpUrl(value, field, {
    allowLocal: process.env.ALLOW_LOCAL_REFERENCE_URLS === "true"
  });
}

function isLocalGeneratedImageStoreReferenceUrl(value) {
  let parsed;
  try {
    parsed = new URL(stringValue(value).trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!/^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/i.test(parsed.pathname)) return false;
  if (!isUnsafeNetworkHost(parsed.hostname)) return false;
  const expectedPort = String(process.env.PORT || 8787);
  if ((parsed.port || defaultPort(parsed.protocol)) !== expectedPort) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const configuredHost = stringValue(process.env.HOST || "127.0.0.1").toLowerCase();
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (configuredHost && configuredHost !== "0.0.0.0" && configuredHost !== "::") allowedHosts.add(configuredHost);
  return allowedHosts.has(host);
}

function defaultPort(protocol) {
  if (protocol === "http:") return "80";
  if (protocol === "https:") return "443";
  return "";
}

function normalizeReference(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    fail("INVALID_REQUEST_SCHEMA", `第 ${index + 1} 个 reference 必须是对象。`);
  }
  return {
    reference_id: stringValue(item.reference_id).trim(),
    entity_name: stringValue(item.entity_name).trim(),
    entity_type: normalizeEntityType(item.entity_type),
    role: normalizeReferenceRole(item.role),
    url: assertReferenceUrlAllowed(item.url, "reference.url"),
    mime_type: stringValue(item.mime_type).trim(),
    display_name: stringValue(item.display_name).trim(),
    description: stringValue(item.description).trim(),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1
  };
}

function normalizeReferencePolicy(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const unbound = source.unbound_entity === "block" ? "block" : "warn";
  return {
    unbound_entity: unbound
  };
}

function normalizeOutput(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const count = normalizeOutputCount(source.count);
  const aspectRatio = stringValue(source.aspect_ratio).trim() || "1:1";
  const quality = stringValue(source.quality).trim() || "high";
  const language = stringValue(source.language).trim() || "zh-CN";
  const returnFormat = stringValue(source.return_format).trim() || "url";
  if (!VALID_ASPECT_RATIOS.includes(aspectRatio)) {
    fail("INVALID_REQUEST_SCHEMA", "output.aspect_ratio 不合法。");
  }
  if (!VALID_OUTPUT_QUALITIES.includes(quality)) {
    fail("INVALID_REQUEST_SCHEMA", "output.quality 不合法。");
  }
  if (!VALID_OUTPUT_LANGUAGES.includes(language)) {
    fail("INVALID_REQUEST_SCHEMA", "output.language 不合法。");
  }
  if (returnFormat !== "url") {
    fail("INVALID_REQUEST_SCHEMA", "output.return_format 只支持 url。");
  }
  return {
    count,
    aspect_ratio: aspectRatio,
    quality,
    return_format: "url",
    language,
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : null
  };
}

function normalizeOutputCount(value) {
  if (value == null || value === "") return 1;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    fail("INVALID_REQUEST_SCHEMA", "output.count 必须是 1 到 4 的整数。");
  }
  return count;
}

function normalizeReferenceRole(value) {
  const role = stringValue(value).trim();
  const normalized = ROLE_ALIASES[role] || role;
  if (!VALID_REFERENCE_ROLES.includes(normalized)) {
    fail("INVALID_REFERENCE_ROLE", "参考图 role 不合法。");
  }
  return normalized;
}

function normalizeEntityType(value) {
  const entityType = stringValue(value).trim();
  const normalized = ENTITY_TYPE_ALIASES[entityType] || entityType;
  if (!normalized || !VALID_ENTITY_TYPES.includes(normalized)) {
    fail("INVALID_REQUEST_SCHEMA", "reference.entity_type 不合法。");
  }
  return normalized;
}

function normalizeCallbackUrl(body) {
  const callbackObject = body.callback && typeof body.callback === "object" && !Array.isArray(body.callback) ? body.callback : null;
  const raw = typeof body.callback === "string" && body.callback.trim()
    ? body.callback
    : callbackObject && typeof callbackObject.url === "string" && callbackObject.url.trim()
      ? callbackObject.url
      : callbackObject && typeof callbackObject.callback_url === "string" && callbackObject.callback_url.trim()
        ? callbackObject.callback_url
    : typeof body.callback_url === "string" && body.callback_url.trim()
      ? body.callback_url
      : "";
  if (!raw) return "";
  return normalizePublicHttpUrl(raw, "callback_url", { allowLocal: false });
}

export function assertNoForbiddenPublicFields(payload) {
  const found = [];
  walk(payload, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_PUBLIC_FIELDS.includes(key)) found.push(key);
    }
  });
  if (found.length) {
    fail("INTERNAL_ERROR", "公共响应包含内部字段。", 500, { fields: [...new Set(found)] });
  }
}

export function walk(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visitor);
  }
}

export function parseAspectSize(aspectRatio) {
  const value = stringValue(aspectRatio).trim();
  if (value === "16:9") return "1792x1024";
  if (value === "9:16") return "1024x1792";
  if (value === "4:3") return "1536x1152";
  if (value === "3:4") return "1152x1536";
  if (value === "1:1") return "1024x1024";
  return "1024x1024";
}
