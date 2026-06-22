import { ImageApiError, clarification, fail, publicErrorPayload } from "../core/errors.js";
import { extractEntityMentions } from "../core/entity-mentions.js";
import { assertNoForbiddenPublicFields, assertReferenceUrlAllowed, hasUnsafeJsonObjectKeys, makeId, parseJsonWithoutDuplicateKeys, stringValue, walk } from "../core/runtime.js";
import { parseRuntimeConfigText } from "../core/runtime-config-file.js";
import { containsHighConfidenceSensitivePayload, normalizeTextForSensitiveScan } from "../core/sensitive-payload.js";
import {
  ENTITY_TYPE_ALIASES,
  ROLE_ALIASES,
  roleLabel,
  taskTypeLabel,
  VALID_ENTITY_TYPES,
  VALID_REFERENCE_ROLES,
  VALID_TASK_TYPES
} from "../core/labels.js";
import { isExplicitPrivateEndpointHost, isUnsafeNetworkHost } from "../core/url-security.js";
import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

const RAGFLOW_TIMEOUT_MS = 8_000;
const RAGFLOW_DNS_TIMEOUT_MS = 1_000;
const RAGFLOW_MAX_RESPONSE_BYTES = 64 * 1024;
const RAGFLOW_MAX_REQUEST_BYTES = 64 * 1024;
const RAGFLOW_MAX_REQUEST_MESSAGE_CHARS = 16_000;
const RAGFLOW_MAX_JSON_DEPTH = 8;
const RAGFLOW_MAX_JSON_KEYS = 120;
const RAGFLOW_MAX_JSON_ARRAY_LENGTH = 64;
const RAGFLOW_MAX_JSON_STRING_LENGTH = 4000;
const RAGFLOW_MAX_ENHANCEMENT_CHARS = 8000;
const ROOT = resolve(import.meta.dirname, "../..");
const PROMPT_MIN_CJK = 80;
const PROMPT_OPTIMIZATION_MAX_PROMPT_CHARS = 4000;
const PROMPT_OPTIMIZATION_MAX_PROMPT_BYTES = 12_000;
const PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_CHARS = 1200;
const PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_BYTES = 4096;
const PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_CHARS = 12_000;
const PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_BYTES = 32 * 1024;
const PROMPT_OPTIMIZATION_MAX_JSON_DEPTH = 8;
const PROMPT_OPTIMIZATION_MAX_JSON_KEYS = 80;
const PROMPT_OPTIMIZATION_MAX_JSON_ARRAY_LENGTH = 32;
const PROMPT_OPTIMIZATION_MAX_JSON_STRING_CHARS = 4096;
const PROMPT_OPTIMIZATION_ALLOWED_FIELDS = new Set([
  "request_id",
  "task_type",
  "prompt",
  "references",
  "reference_policy"
]);
const PROMPT_REFERENCE_ALLOWED_FIELDS = new Set([
  "reference_id",
  "entity_name",
  "entity_type",
  "role",
  "url",
  "mime_type",
  "display_name",
  "description",
  "order"
]);
const PROMPT_REFERENCE_POLICY_ALLOWED_FIELDS = new Set([
  "unbound_entity"
]);
const PROMPT_OPTIMIZATION_FORBIDDEN_FIELDS = new Set([
  "callback",
  "callback_url",
  "options",
  "provider",
  "provider_config",
  "provider_options",
  "model",
  "headers",
  "authorization",
  "Authorization",
  "api_key",
  "apiKey",
  "token",
  "secret",
  "internal_prompt",
  "final_prompt",
  "compiled_prompt",
  "provider_payload",
  "provider_internal_payload",
  "provider_raw_payload",
  "provider_raw_response",
  "raw_provider_payload",
  "raw_provider_response",
  "images",
  "image",
  "b64_json",
  "base64",
  "data_url",
  "ragflow_status",
  "fallback_status"
]);
const FORBIDDEN_CANONICAL_SCHEMA_KEYS = new Set([
  "__proto__",
  "proto",
  "prototype",
  "constructor",
  "finalprompt",
  "compiledprompt",
  "internalprompt",
  "provider",
  "providerconfig",
  "provideroptions",
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
  "refreshtoken",
  "authtoken",
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
  "context"
]);
const RAGFLOW_ALLOWED_FIELDS = new Set([
  "scene_summary",
  "visual_focus",
  "story_function",
  "action_stages",
  "shot_plan",
  "normalized_shot_plan",
  "lighting_notes",
  "composition_notes",
  "negative_notes",
  "missing_constraints"
]);
const RAGFLOW_FORBIDDEN_CANONICAL_OUTPUT_KEYS = new Set([
  ...FORBIDDEN_CANONICAL_SCHEMA_KEYS,
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
const RAGFLOW_CONSUMED_FIELDS_BY_TASK = Object.freeze({
  text_image: new Set(["visual_focus", "lighting_notes", "composition_notes", "missing_constraints"]),
  image_reference: new Set(["visual_focus", "lighting_notes", "composition_notes", "missing_constraints"]),
  character_multiview: new Set(["visual_focus", "composition_notes", "missing_constraints"]),
  scene_multiview: new Set(["scene_summary", "visual_focus", "lighting_notes", "composition_notes", "missing_constraints"]),
  prop_multiview: new Set(["visual_focus", "composition_notes", "missing_constraints"]),
  storyboard: new Set(["story_function", "action_stages", "lighting_notes", "composition_notes", "missing_constraints"])
});
const RAGFLOW_FORBIDDEN_STRUCTURAL_TEXT = /RAGFlow|fallback|provider\s*:|provider_internal_payload|raw_provider|reference_id|asset_id|primary|auxiliary|weight|priority|主参考|辅参考|权重|优先级/i;
const RAGFLOW_FORBIDDEN_INTERNAL_MARKER_TEXT = /(?:final_prompt|compiled_prompt|internal_prompt|provider_payload)/i;
const PROMPT_PUBLIC_SUCCESS_FIELDS = new Set([
  "status",
  "request_id",
  "optimization_id",
  "task_type",
  "task_type_label",
  "generation_mode",
  "optimized_prompt",
  "normalized",
  "warnings",
  "trace_id"
]);
const PROMPT_PUBLIC_ERROR_FIELDS = new Set([
  "status",
  "request_id",
  "error_code",
  "message",
  "trace_id"
]);
const PROMPT_PUBLIC_FORBIDDEN_KEY = /(?:final_prompt|compiled_prompt|internal_prompt|enhancement|ragflow|fallback|provider|callback|images?|b64_json|base64|data_url|authorization|cookie|bearer|api[_-]?key|token|secret|stack|raw)/i;
const PROMPT_PUBLIC_FORBIDDEN_TEXT = /(?:RAGFlow|fallback_status|ragflow_status|provider_internal_payload|data:image|stack trace)/i;
const PROMPT_OPTIMIZER_FORBIDDEN_OUTPUT_TEXT = /RAGFlow|fallback|provider\s*:|provider_internal_payload|raw_provider|data:image|enhancement|input_analysis|storyboard_processing/i;
const PROMPT_HIDDEN_INTERNAL_MARKER_TEXT = /(?:final_prompt|compiled_prompt|internal_prompt|provider_payload)/i;
const RAGFLOW_DEPLOYMENT_TIERS = new Set(["production", "staging", "development", "test"]);

export async function handlePromptOptimization(body, options = {}) {
  const fallbackRequestId = safeRequestId(body && body.request_id) || makeId("req");
  const traceId = makeId("trace");
  try {
    if (body && body.__invalid) {
      throw new ImageApiError({
        statusCode: 400,
        status: "failed",
        errorCode: body.error_code || "INVALID_REQUEST_SCHEMA",
        message: body.message || "请求体不是合法 JSON。"
      });
    }
    assertPromptOptimizationBodyObject(body);
    assertPromptOptimizationRequestFields(body);
    assertPromptOptimizationNestedSchema(body);
    if (!stringValue(body.prompt).trim()) {
      clarification("PROMPT_REQUIRED", "prompt 不能为空。");
    }

    const env = options.env || process.env;
    const request = normalizePromptOptimizationRequest(body, env, fallbackRequestId);
    const context = await buildPromptOptimizationContext(request, {
      fetchImpl: options.fetchImpl || globalThis.fetch,
      env,
      lookupHost: options.lookupHost || dnsLookup
    });
    const optimizedPrompt = compileOptimizedPrompt(context);
    validateOptimizedPrompt(optimizedPrompt, context);
    return {
      statusCode: 200,
      payload: buildPromptOptimizationResponse({
        request,
        context,
        optimizedPrompt,
        traceId
      })
    };
  } catch (error) {
    const result = publicErrorPayload(error, fallbackRequestId);
    let statusCode = result.statusCode;
    let payload = {
      ...result.payload,
      trace_id: traceId
    };
    if (containsForbiddenPublicText(payload.message)) {
      payload.message = safePromptOptimizationErrorMessage(payload.error_code, payload.status);
    }
    try {
      assertNoForbiddenPublicFields(payload);
      assertPromptOptimizationPublicPayload(payload, "error");
    } catch {
      payload = {
        status: "failed",
        request_id: fallbackRequestId,
        error_code: "INTERNAL_ERROR",
        message: "服务内部错误。",
        trace_id: traceId
      };
      statusCode = 500;
    }
    return { statusCode, payload };
  }
}

function safePromptOptimizationErrorMessage(errorCode, status) {
  if (status === "needs_clarification") return "请求需要补充信息。";
  if (errorCode === "RAGFLOW_CONFIG_INVALID") return "提示词优化服务配置无效。";
  if (errorCode === "RAGFLOW_OPENAI_ENDPOINT_NOT_FOUND" || errorCode === "RAGFLOW_OPTIMIZER_FAILED") {
    return "提示词优化服务暂时不可用，请稍后重试。";
  }
  return "请求无效。";
}

export function normalizePromptOptimizationRequest(body, env = process.env, fallbackRequestId = "") {
  const limits = promptOptimizationLimits(env);
  assertPromptOptimizationBodyObject(body);
  assertPromptOptimizationJsonLimits(body, limits);
  assertPromptOptimizationRequestFields(body);
  const taskType = requiredStringField(body, "task_type").trim();
  if (!VALID_TASK_TYPES.includes(taskType)) {
    clarification("UNSUPPORTED_TASK_TYPE", "不支持的 task_type。");
  }
  const prompt = requiredStringField(body, "prompt").trim();
  if (!prompt) {
    clarification("PROMPT_REQUIRED", "prompt 不能为空。");
  }
  assertTextBoundary(prompt, "prompt", limits.maxPromptChars, limits.maxPromptBytes);
  assertNoForbiddenInputText(prompt, "prompt");
  const references = normalizePromptOptimizationReferences(body.references, limits);
  const referencePolicy = normalizePromptOptimizationReferencePolicy(body.reference_policy);
  const requestId = safeRequestId(body.request_id) || safeRequestId(fallbackRequestId) || makeId("req");
  const request = {
    request_id: requestId,
    task_type: taskType,
    prompt,
    references,
    reference_policy: referencePolicy,
    generation_mode: references.length ? "image_to_image" : "text_to_image"
  };
  return {
    ...request,
    entity_mentions: extractEntityMentions(request.prompt)
  };
}

function assertPromptOptimizationBodyObject(body) {
  if (!isPlainRecord(body)) {
    fail("INVALID_REQUEST_SCHEMA", "请求体必须是 JSON 对象。");
  }
}

function assertPromptOptimizationRequestFields(body) {
  assertAllowedObjectKeys(body, PROMPT_OPTIMIZATION_ALLOWED_FIELDS, "请求包含不允许的提示词优化字段。");
  if (body.request_id != null && (typeof body.request_id !== "string" || !safeRequestId(body.request_id))) {
    fail("INVALID_REQUEST_SCHEMA", "request_id 必须是安全字符串。");
  }
  assertNoForbiddenSchemaKeys(body);
}

function assertPromptOptimizationNestedSchema(body) {
  if (body.references != null) {
    if (!Array.isArray(body.references)) fail("INVALID_REQUEST_SCHEMA", "references 必须是数组。");
    if (body.references.length > 16) fail("INVALID_REQUEST_SCHEMA", "references 最多支持 16 个。");
    body.references.forEach((ref, index) => {
      if (!isPlainRecord(ref)) fail("INVALID_REQUEST_SCHEMA", `第 ${index + 1} 个 reference 必须是对象。`);
      assertAllowedObjectKeys(ref, PROMPT_REFERENCE_ALLOWED_FIELDS, "reference 包含不允许的字段。");
    });
  }
  if (body.reference_policy != null) {
    if (!isPlainRecord(body.reference_policy)) fail("INVALID_REQUEST_SCHEMA", "reference_policy 必须是对象。");
    assertAllowedObjectKeys(body.reference_policy, PROMPT_REFERENCE_POLICY_ALLOWED_FIELDS, "reference_policy 包含不允许的字段。");
    if (body.reference_policy.unbound_entity != null && typeof body.reference_policy.unbound_entity !== "string") {
      fail("INVALID_REQUEST_SCHEMA", "reference_policy.unbound_entity 必须是字符串。");
    }
    if (body.reference_policy.unbound_entity != null && !["warn", "block"].includes(body.reference_policy.unbound_entity)) {
      fail("INVALID_REQUEST_SCHEMA", "reference_policy.unbound_entity 只支持 warn 或 block。");
    }
  }
}

function assertNoForbiddenSchemaKeys(value) {
  walk(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (!isPlainRecord(node)) fail("INVALID_REQUEST_SCHEMA", "请求体必须是 JSON 对象。");
    for (const key of Object.keys(node)) {
      if (isForbiddenSchemaKey(key)) {
        fail("INVALID_REQUEST_SCHEMA", "请求包含不允许的提示词优化字段。");
      }
    }
  });
}

function assertAllowedObjectKeys(value, allowed, message) {
  if (!isPlainRecord(value)) fail("INVALID_REQUEST_SCHEMA", message);
  const seen = new Set();
  for (const key of Object.keys(value)) {
    const canonical = canonicalSchemaKey(key);
    if (seen.has(canonical)) fail("INVALID_REQUEST_SCHEMA", message);
    seen.add(canonical);
    if (isForbiddenSchemaKey(key) || !allowed.has(key)) {
      fail("INVALID_REQUEST_SCHEMA", message);
    }
  }
}

function isForbiddenSchemaKey(key) {
  if (PROMPT_OPTIMIZATION_FORBIDDEN_FIELDS.has(key)) return true;
  return FORBIDDEN_CANONICAL_SCHEMA_KEYS.has(canonicalSchemaKey(key));
}

function canonicalSchemaKey(key) {
  return normalizeTextForSensitiveScan(key)
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype;
}

function requiredStringField(body, field) {
  if (typeof body[field] !== "string") {
    if (field === "prompt" && body[field] == null) return "";
    if (field === "task_type" && body[field] == null) return "";
    fail("INVALID_REQUEST_SCHEMA", `${field} 必须是字符串。`);
  }
  return body[field];
}

function safeRequestId(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  return /^[A-Za-z0-9_-]{1,120}$/.test(text) ? text : "";
}

function normalizePromptOptimizationReferences(value, limits) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("INVALID_REQUEST_SCHEMA", "references 必须是数组。");
  if (value.length > 16) fail("INVALID_REQUEST_SCHEMA", "references 最多支持 16 个。");
  const references = value.map((item, index) => normalizePromptOptimizationReference(item, index, limits));
  assertReferenceAggregateBoundary(references, limits);
  return references;
}

function normalizePromptOptimizationReference(ref, index, limits) {
  if (!isPlainRecord(ref)) {
    fail("INVALID_REQUEST_SCHEMA", `第 ${index + 1} 个 reference 必须是对象。`);
  }
  assertAllowedObjectKeys(ref, PROMPT_REFERENCE_ALLOWED_FIELDS, "reference 包含不允许的字段。");
  const referenceId = requiredReferenceString(ref, "reference_id", index, 80, limits);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(referenceId)) {
    fail("INVALID_REQUEST_SCHEMA", "reference_id 只能包含字母、数字、下划线和短横线，且必须以字母开头。");
  }
  const entityName = requiredReferenceString(ref, "entity_name", index, 120, limits);
  const entityType = normalizePromptReferenceEntityType(requiredReferenceString(ref, "entity_type", index, 80, limits));
  const role = normalizePromptReferenceRole(requiredReferenceString(ref, "role", index, 80, limits));
  const url = assertReferenceUrlAllowed(requiredReferenceString(ref, "url", index, 2048, limits), "reference.url");
  const mimeType = optionalReferenceString(ref, "mime_type", 80, limits) || "image/png";
  if (!/^image\/(?:png|jpeg|jpg|webp)$/i.test(mimeType)) {
    fail("INVALID_REQUEST_SCHEMA", "reference.mime_type 只支持 image/png、image/jpeg 或 image/webp。");
  }
  const item = {
    reference_id: referenceId,
    entity_name: entityName,
    entity_type: entityType,
    role,
    url,
    mime_type: mimeType.replace(/^image\/jpg$/i, "image/jpeg"),
    display_name: optionalReferenceString(ref, "display_name", 160, limits),
    description: optionalReferenceString(ref, "description", 800, limits),
    order: normalizeReferenceOrder(ref.order, index)
  };
  assertReferenceItemBoundary(item, limits);
  return item;
}

function requiredReferenceString(ref, field, index, maxLength = 160, limits = defaultPromptOptimizationLimits()) {
  if (typeof ref[field] !== "string" || !ref[field].trim()) {
    fail("INVALID_REQUEST_SCHEMA", `第 ${index + 1} 个 reference.${field} 不能为空。`);
  }
  const text = ref[field].trim();
  if (unicodeLength(text) > maxLength) {
    fail("INVALID_REQUEST_SCHEMA", `reference.${field} 过长。`);
  }
  assertNoForbiddenInputText(text, `reference.${field}`);
  return text;
}

function optionalReferenceString(ref, field, maxLength, limits = defaultPromptOptimizationLimits()) {
  if (ref[field] == null) return "";
  if (typeof ref[field] !== "string") fail("INVALID_REQUEST_SCHEMA", `reference.${field} 必须是字符串。`);
  const text = ref[field].trim();
  if (unicodeLength(text) > maxLength) fail("INVALID_REQUEST_SCHEMA", `reference.${field} 过长。`);
  assertNoForbiddenInputText(text, `reference.${field}`);
  return text;
}

function assertNoForbiddenInputText(value, field) {
  const text = stringValue(value);
  if (containsPromptOptimizationSensitivePayload(text)) {
    fail("INVALID_REQUEST_SCHEMA", `${field} 包含不允许的敏感内容。`);
  }
}

function containsPromptOptimizationSensitivePayload(value) {
  const text = stringValue(value);
  if (!text) return false;
  return containsHighConfidenceSensitivePayload(text);
}

function promptOptimizationLimits(env = process.env) {
  return {
    maxPromptChars: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_PROMPT_CHARS, 1, 20_000, PROMPT_OPTIMIZATION_MAX_PROMPT_CHARS),
    maxPromptBytes: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_PROMPT_BYTES, 1, 64 * 1024, PROMPT_OPTIMIZATION_MAX_PROMPT_BYTES),
    maxReferenceTextChars: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_CHARS, 1, 4000, PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_CHARS),
    maxReferenceTextBytes: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_BYTES, 1, 16 * 1024, PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_BYTES),
    maxReferenceAggregateChars: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_CHARS, 1, 40_000, PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_CHARS),
    maxReferenceAggregateBytes: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_BYTES, 1, 128 * 1024, PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_BYTES),
    maxJsonDepth: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_JSON_DEPTH, 0, 24, PROMPT_OPTIMIZATION_MAX_JSON_DEPTH),
    maxJsonKeys: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_JSON_KEYS, 1, 400, PROMPT_OPTIMIZATION_MAX_JSON_KEYS),
    maxJsonArrayLength: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_JSON_ARRAY_LENGTH, 0, 64, PROMPT_OPTIMIZATION_MAX_JSON_ARRAY_LENGTH),
    maxJsonStringChars: strictIntEnv(env.PROMPT_OPTIMIZATION_MAX_JSON_STRING_CHARS, 1, 20_000, PROMPT_OPTIMIZATION_MAX_JSON_STRING_CHARS)
  };
}

function defaultPromptOptimizationLimits() {
  return {
    maxPromptChars: PROMPT_OPTIMIZATION_MAX_PROMPT_CHARS,
    maxPromptBytes: PROMPT_OPTIMIZATION_MAX_PROMPT_BYTES,
    maxReferenceTextChars: PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_CHARS,
    maxReferenceTextBytes: PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_BYTES,
    maxReferenceAggregateChars: PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_CHARS,
    maxReferenceAggregateBytes: PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_BYTES,
    maxJsonDepth: PROMPT_OPTIMIZATION_MAX_JSON_DEPTH,
    maxJsonKeys: PROMPT_OPTIMIZATION_MAX_JSON_KEYS,
    maxJsonArrayLength: PROMPT_OPTIMIZATION_MAX_JSON_ARRAY_LENGTH,
    maxJsonStringChars: PROMPT_OPTIMIZATION_MAX_JSON_STRING_CHARS
  };
}

function assertPromptOptimizationJsonLimits(value, limits) {
  const stack = [{ value, depth: 0 }];
  let keys = 0;
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > limits.maxJsonDepth) fail("INVALID_REQUEST_SCHEMA", "请求体层级过深。");
    const node = current.value;
    if (typeof node === "string") {
      if (unicodeLength(node) > limits.maxJsonStringChars) fail("INVALID_REQUEST_SCHEMA", "请求体字符串过长。");
      continue;
    }
    if (Array.isArray(node)) {
      if (node.length > limits.maxJsonArrayLength) fail("INVALID_REQUEST_SCHEMA", "请求体数组过长。");
      for (const item of node) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (node && typeof node === "object") {
      if (!isPlainRecord(node)) fail("INVALID_REQUEST_SCHEMA", "请求体必须是 JSON 对象。");
      const entries = Object.entries(node);
      keys += entries.length;
      if (keys > limits.maxJsonKeys) fail("INVALID_REQUEST_SCHEMA", "请求体字段过多。");
      for (const [, item] of entries) stack.push({ value: item, depth: current.depth + 1 });
    }
  }
}

function assertTextBoundary(text, field, maxChars, maxBytes) {
  if (unicodeLength(text) > maxChars || Buffer.byteLength(text, "utf8") > maxBytes) {
    fail("INVALID_REQUEST_SCHEMA", `${field} 过长。`);
  }
}

function assertReferenceItemBoundary(ref, limits) {
  const text = [
    ref.entity_name,
    ref.display_name,
    ref.description
  ].filter(Boolean).join("\n");
  assertTextBoundary(text, "reference", limits.maxReferenceTextChars, limits.maxReferenceTextBytes);
}

function assertReferenceAggregateBoundary(references, limits) {
  const text = references.map((ref) => [
    ref.entity_name,
    ref.display_name,
    ref.description
  ].filter(Boolean).join("\n")).join("\n");
  assertTextBoundary(text, "references", limits.maxReferenceAggregateChars, limits.maxReferenceAggregateBytes);
}

function unicodeLength(text) {
  return Array.from(stringValue(text)).length;
}

function normalizePromptReferenceRole(value) {
  const normalized = ROLE_ALIASES[value] || value;
  if (!VALID_REFERENCE_ROLES.includes(normalized)) {
    fail("INVALID_REFERENCE_ROLE", "参考图 role 不合法。");
  }
  return normalized;
}

function normalizePromptReferenceEntityType(value) {
  const normalized = ENTITY_TYPE_ALIASES[value] || value;
  if (!VALID_ENTITY_TYPES.includes(normalized)) {
    fail("INVALID_REQUEST_SCHEMA", "reference.entity_type 不合法。");
  }
  return normalized;
}

function normalizeReferenceOrder(value, index) {
  if (value == null || value === "") return index + 1;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("INVALID_REQUEST_SCHEMA", "reference.order 必须是数字。");
  }
  const order = Math.floor(value);
  if (order < 1 || order > 1000) fail("INVALID_REQUEST_SCHEMA", "reference.order 不合法。");
  return order;
}

function normalizePromptOptimizationReferencePolicy(value) {
  if (value == null) return { unbound_entity: "warn" };
  if (!isPlainRecord(value)) {
    fail("INVALID_REQUEST_SCHEMA", "reference_policy 必须是对象。");
  }
  assertAllowedObjectKeys(value, PROMPT_REFERENCE_POLICY_ALLOWED_FIELDS, "reference_policy 包含不允许的字段。");
  if (value.unbound_entity != null && typeof value.unbound_entity !== "string") {
    fail("INVALID_REQUEST_SCHEMA", "reference_policy.unbound_entity 必须是字符串。");
  }
  if (value.unbound_entity != null && !["warn", "block"].includes(value.unbound_entity)) {
    fail("INVALID_REQUEST_SCHEMA", "reference_policy.unbound_entity 只支持 warn 或 block。");
  }
  return {
    unbound_entity: value.unbound_entity === "block" ? "block" : "warn"
  };
}

async function buildPromptOptimizationContext(request, options = {}) {
  const binding = resolvePromptOptimizationReferences(request, request.entity_mentions);
  const referencePlan = buildReferencePlan({
    request,
    entity_mentions: binding.entity_mentions,
    resolved_references: binding.resolved_references
  });
  const enhancement = await callRagflowEnhancementIfAvailable({
    request,
    binding,
    referencePlan,
    fetchImpl: options.fetchImpl,
    env: options.env,
    lookupHost: options.lookupHost
  });
  return {
    request,
    binding,
    referencePlan,
    enhancement
  };
}

function resolvePromptOptimizationReferences(request, entityMentions) {
  const references = validateReferences(request.references || []);
  if (request.task_type === "text_image" && references.length) {
    fail("REFERENCES_NOT_ALLOWED", "text_image 不允许携带 references。");
  }
  const warnings = taskReferenceWarnings(request, references);
  const refsByEntity = new Map();
  for (const ref of references) {
    const list = refsByEntity.get(ref.entity_name) || [];
    list.push(ref);
    refsByEntity.set(ref.entity_name, list);
  }

  const normalizedMentions = entityMentions.map((mention) => {
    const matched = refsByEntity.get(mention.entity_name) || [];
    if (matched.length) {
      return {
        mention_id: mention.mention_id,
        marker: mention.marker,
        entity_name: mention.entity_name,
        reference_status: "bound",
        matched_reference_ids: matched.map((item) => item.reference_id)
      };
    }
    const warning = {
      code: "ENTITY_REFERENCE_NOT_FOUND",
      message: `实体「${mention.entity_name}」没有绑定参考图。`,
      entity_name: mention.entity_name
    };
    if (request.reference_policy.unbound_entity === "block") {
      clarification("ENTITY_REFERENCE_NOT_FOUND", warning.message, 200, warning);
    }
    warnings.push(warning);
    return {
      mention_id: mention.mention_id,
      marker: mention.marker,
      entity_name: mention.entity_name,
      reference_status: "unbound",
      matched_reference_ids: []
    };
  });

  if (request.task_type === "image_reference" && !references.length) {
    clarification("REFERENCE_REQUIRED", "image_reference 需要至少一张参考图。");
  }

  return {
    entity_mentions: normalizedMentions,
    resolved_references: references,
    references_used: references.map(publicPromptReference),
    warnings
  };
}

function taskReferenceWarnings(request, references) {
  if (request.task_type === "character_multiview" && !references.some(isCharacterReference)) {
    return [{
      code: "CHARACTER_REFERENCE_MISSING",
      message: "人物多视角图未提供人物脸部或角色参考图，人物一致性将主要依赖文本描述。"
    }];
  }
  if (request.task_type === "scene_multiview" && !references.some(isSceneReference)) {
    return [{
      code: "SCENE_REFERENCE_MISSING",
      message: "场景多视图图未提供场景参考图，空间一致性将主要依赖文本描述。"
    }];
  }
  if (request.task_type === "prop_multiview" && !references.some(isPropReference)) {
    return [{
      code: "PROP_REFERENCE_MISSING",
      message: "道具多视图图未提供道具参考图，道具一致性将主要依赖文本描述。"
    }];
  }
  return [];
}

export function validateReferences(references = []) {
  if (!Array.isArray(references)) fail("INVALID_REQUEST_SCHEMA", "references 必须是数组。");
  const seenIds = new Set();
  const normalized = references.map((ref, index) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
      fail("INVALID_REQUEST_SCHEMA", `第 ${index + 1} 个 reference 必须是对象。`);
    }
    if (!ref.reference_id) fail("INVALID_REQUEST_SCHEMA", "reference_id 不能为空。");
    if (seenIds.has(ref.reference_id)) fail("DUPLICATE_REFERENCE_ID", "参考图 ID 重复，请检查上传的参考图。");
    seenIds.add(ref.reference_id);
    if (!ref.entity_name) fail("INVALID_REQUEST_SCHEMA", "reference.entity_name 不能为空。");
    if (!VALID_REFERENCE_ROLES.includes(ref.role)) fail("INVALID_REFERENCE_ROLE", "参考图 role 不合法。");
    const url = assertReferenceUrlAllowed(ref.url, "reference.url");

    const item = {
      ...ref,
      url,
      order: Number.isFinite(Number(ref.order)) ? Number(ref.order) : index + 1,
      role_label: roleLabel(ref.role)
    };
    return item;
  });
  return normalized.sort((a, b) => a.order - b.order);
}

function publicPromptReference(ref) {
  return {
    reference_id: ref.reference_id,
    entity_name: ref.entity_name,
    entity_type: ref.entity_type,
    role: ref.role,
    role_label: roleLabel(ref.role),
    display_name: ref.display_name || "",
    order: ref.order
  };
}

export async function callRagflowEnhancementIfAvailable({ request, binding, referencePlan, fetchImpl = globalThis.fetch, env = process.env, lookupHost = dnsLookup } = {}) {
  let config;
  try {
    config = ragflowConfig(env);
  } catch (error) {
    if (error instanceof ImageApiError && error.errorCode !== "RAGFLOW_CONFIG_MISSING" && hasExplicitRagflowRuntimeEnv(env)) throw error;
    return null;
  }
  try {
    const candidate = await callRagflowPromptOptimizer({
      request,
      binding,
      referencePlan,
      fetchImpl,
      env,
      config,
      lookupHost
    });
    return validateRagflowEnhancement(candidate, {
      request,
      binding,
      referencePlan,
      maxChars: config.maxEnhancementChars
    });
  } catch (error) {
    if (error instanceof ImageApiError) throw error;
    return null;
  }
}

function hasExplicitRagflowRuntimeEnv(env = {}) {
  return [
    "RAGFLOW_BASE_URL",
    "RAGFLOW_API_KEY",
    "RAGFLOW_CHAT_ID",
    "RAGFLOW_MODEL",
    "RAGFLOW_DEPLOYMENT_TIER",
    "RAGFLOW_ALLOW_PRIVATE_ENDPOINTS",
    "RAGFLOW_ALLOWED_ORIGINS",
    "RAGFLOW_TIMEOUT_MS",
    "RAGFLOW_DNS_TIMEOUT_MS",
    "RAGFLOW_MAX_REQUEST_BYTES",
    "RAGFLOW_MAX_REQUEST_MESSAGE_CHARS",
    "RAGFLOW_MAX_RESPONSE_BYTES",
    "RAGFLOW_MAX_JSON_DEPTH",
    "RAGFLOW_MAX_JSON_KEYS",
    "RAGFLOW_MAX_JSON_ARRAY_LENGTH",
    "RAGFLOW_MAX_JSON_STRING_LENGTH",
    "RAGFLOW_MAX_ENHANCEMENT_CHARS"
  ].some((key) => stringValue(env[key]).trim() !== "");
}

export async function callRagflowPromptOptimizer({ request, binding, referencePlan, fetchImpl = globalThis.fetch, env = process.env, config = null, lookupHost = dnsLookup } = {}) {
  const activeConfig = config || ragflowConfig(env);
  const userPrompt = ragflowUserPrompt(request, binding, referencePlan);
  assertNoSensitiveRagflowOutbound(userPrompt);
  const requestBody = buildRagflowPromptOptimizerRequestBody(activeConfig, userPrompt);
  const deadline = createDeadline(activeConfig.timeoutMs);
  let resolution;
  try {
    resolution = await validateRagflowEndpointForFetch(activeConfig, lookupHost, deadline);
  } catch (error) {
    if (error && error.name === "RagflowLookupTimeoutError") return null;
    throw error;
  }
  const remainingMs = deadline.remainingMs();
  if (remainingMs <= 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  try {
    const requestInit = {
      method: "POST",
      headers: ragflowRequestHeaders(activeConfig),
      body: requestBody,
      redirect: "manual",
      signal: controller.signal
    };
    const response = fetchImpl === globalThis.fetch
      ? await fetchRagflowWithPinnedLookup(activeConfig.endpoint, requestInit, resolution, activeConfig.maxResponseBytes)
      : await fetchImpl(activeConfig.endpoint, requestInit);
    if (response.status >= 300 && response.status < 400) return null;
    if (!response.ok) {
      throw new ImageApiError({
        statusCode: response.status === 404 ? 503 : 502,
        status: "failed",
        errorCode: response.status === 404 ? "RAGFLOW_OPENAI_ENDPOINT_NOT_FOUND" : "RAGFLOW_OPTIMIZER_FAILED",
        message: "提示词优化服务暂时不可用，请稍后重试。"
      });
    }
    if (!isJsonContentType(getHeader(response, "content-type"))) return null;
    const text = await readBoundedResponseText(response, activeConfig.maxResponseBytes);
    if (text == null) return null;
    const json = parseBoundedJson(text, activeConfig.jsonLimits);
    if (!json) return null;
    if (isRagflowErrorEnvelope(json)) return null;
    return parseRagflowOptimizedPrompt(json, activeConfig.jsonLimits);
  } catch (error) {
    if (error && (error.name === "AbortError" || error.name === "RagflowResponseLimitError" || error.name === "RagflowLookupTimeoutError")) return null;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildRagflowPromptOptimizerRequestBody(config, userPrompt) {
  const systemPrompt = ragflowSystemPrompt();
  const messageChars = unicodeLength(systemPrompt) + unicodeLength(userPrompt);
  if (messageChars > config.maxRequestMessageChars) {
    fail("INVALID_REQUEST_SCHEMA", "请求消息过长。");
  }
  const body = JSON.stringify({
    model: config.model,
    stream: false,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });
  if (Buffer.byteLength(body, "utf8") > config.maxRequestBytes) {
    fail("INVALID_REQUEST_SCHEMA", "请求体过大。");
  }
  return body;
}

function assertNoSensitiveRagflowOutbound(userPrompt) {
  if (!containsPromptOptimizationSensitivePayload(userPrompt)) return;
  throw new ImageApiError({
    statusCode: 400,
    status: "failed",
    errorCode: "INVALID_REQUEST_SCHEMA",
    message: "请求包含不允许的敏感内容。"
  });
}

export function ragflowConfig(env = process.env) {
  const fileConfig = readRagflowRuntimeConfig(env);
  const baseUrl = stringValue(env.RAGFLOW_BASE_URL || fileConfig.baseUrl).trim();
  const apiKey = stringValue(env.RAGFLOW_API_KEY || fileConfig.apiKey).trim();
  const chatId = stringValue(env.RAGFLOW_CHAT_ID || fileConfig.chatId).trim();
  const explicitConfig = assertExplicitRagflowConfigValues(env);
  if (!baseUrl || !apiKey || !chatId) {
    throw new ImageApiError({
      statusCode: 503,
      status: "failed",
      errorCode: "RAGFLOW_CONFIG_MISSING",
      message: "提示词优化服务配置缺失。"
    });
  }
  const normalized = normalizeRagflowBaseUrl(baseUrl, env);
  const endpoint = `${normalized.baseUrl}/api/v1/openai/${encodeURIComponent(chatId)}/chat/completions`;
  const timeoutMs = explicitConfig.timeoutMs;
  return {
    apiKey,
    model: stringValue(env.RAGFLOW_MODEL || fileConfig.model).trim() || "model",
    endpoint,
    approvedOrigin: normalized.origin,
    tier: normalized.tier,
    allowPrivateEndpoint: normalized.allowPrivateEndpoint,
    timeoutMs,
    dnsTimeoutMs: strictIntEnv(env.RAGFLOW_DNS_TIMEOUT_MS, 1, timeoutMs, Math.min(RAGFLOW_DNS_TIMEOUT_MS, timeoutMs)),
    maxRequestBytes: strictIntEnv(env.RAGFLOW_MAX_REQUEST_BYTES, 512, 1024 * 1024, RAGFLOW_MAX_REQUEST_BYTES),
    maxRequestMessageChars: strictIntEnv(env.RAGFLOW_MAX_REQUEST_MESSAGE_CHARS, 128, 128_000, RAGFLOW_MAX_REQUEST_MESSAGE_CHARS),
    maxResponseBytes: strictIntEnv(env.RAGFLOW_MAX_RESPONSE_BYTES, 1024, 1024 * 1024, RAGFLOW_MAX_RESPONSE_BYTES),
    maxEnhancementChars: strictIntEnv(env.RAGFLOW_MAX_ENHANCEMENT_CHARS, 1000, 64_000, RAGFLOW_MAX_ENHANCEMENT_CHARS),
    jsonLimits: {
      maxDepth: strictIntEnv(env.RAGFLOW_MAX_JSON_DEPTH, 2, 32, RAGFLOW_MAX_JSON_DEPTH),
      maxKeys: strictIntEnv(env.RAGFLOW_MAX_JSON_KEYS, 8, 1000, RAGFLOW_MAX_JSON_KEYS),
      maxArrayLength: strictIntEnv(env.RAGFLOW_MAX_JSON_ARRAY_LENGTH, 1, 1000, RAGFLOW_MAX_JSON_ARRAY_LENGTH),
      maxStringLength: strictIntEnv(env.RAGFLOW_MAX_JSON_STRING_LENGTH, 64, 64_000, RAGFLOW_MAX_JSON_STRING_LENGTH),
      maxTotalChars: strictIntEnv(env.RAGFLOW_MAX_ENHANCEMENT_CHARS, 1000, 64_000, RAGFLOW_MAX_ENHANCEMENT_CHARS)
    }
  };
}

function assertExplicitRagflowConfigValues(env) {
  const timeoutMs = strictIntEnv(env.RAGFLOW_TIMEOUT_MS, 50, 60_000, RAGFLOW_TIMEOUT_MS);
  strictIntEnv(env.RAGFLOW_DNS_TIMEOUT_MS, 1, timeoutMs, Math.min(RAGFLOW_DNS_TIMEOUT_MS, timeoutMs));
  strictIntEnv(env.RAGFLOW_MAX_REQUEST_BYTES, 512, 1024 * 1024, RAGFLOW_MAX_REQUEST_BYTES);
  strictIntEnv(env.RAGFLOW_MAX_REQUEST_MESSAGE_CHARS, 128, 128_000, RAGFLOW_MAX_REQUEST_MESSAGE_CHARS);
  strictIntEnv(env.RAGFLOW_MAX_RESPONSE_BYTES, 1024, 1024 * 1024, RAGFLOW_MAX_RESPONSE_BYTES);
  strictIntEnv(env.RAGFLOW_MAX_ENHANCEMENT_CHARS, 1000, 64_000, RAGFLOW_MAX_ENHANCEMENT_CHARS);
  strictIntEnv(env.RAGFLOW_MAX_JSON_DEPTH, 2, 32, RAGFLOW_MAX_JSON_DEPTH);
  strictIntEnv(env.RAGFLOW_MAX_JSON_KEYS, 8, 1000, RAGFLOW_MAX_JSON_KEYS);
  strictIntEnv(env.RAGFLOW_MAX_JSON_ARRAY_LENGTH, 1, 1000, RAGFLOW_MAX_JSON_ARRAY_LENGTH);
  strictIntEnv(env.RAGFLOW_MAX_JSON_STRING_LENGTH, 64, 64_000, RAGFLOW_MAX_JSON_STRING_LENGTH);
  if (stringValue(env.RAGFLOW_DEPLOYMENT_TIER).trim()) normalizeRagflowDeploymentTier(env.RAGFLOW_DEPLOYMENT_TIER);
  parseAllowedOrigins(env.RAGFLOW_ALLOWED_ORIGINS);
  return { timeoutMs };
}

function normalizeRagflowBaseUrl(raw, env) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throwRagflowConfigInvalid();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throwRagflowConfigInvalid();
  if (parsed.username || parsed.password) throwRagflowConfigInvalid();
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) throwRagflowConfigInvalid();
  const tier = normalizeRagflowDeploymentTier(env.RAGFLOW_DEPLOYMENT_TIER);
  const requiresProductionControls = tier === "production" || tier === "staging";
  const allowPrivateEndpoint = !requiresProductionControls && stringValue(env.RAGFLOW_ALLOW_PRIVATE_ENDPOINTS).trim() === "true";
  const allowedOrigins = parseAllowedOrigins(env.RAGFLOW_ALLOWED_ORIGINS);
  if (requiresProductionControls && parsed.protocol !== "https:") throwRagflowConfigInvalid();
  if (requiresProductionControls && !allowedOrigins.size) throwRagflowConfigInvalid();
  if (allowedOrigins.size && !allowedOrigins.has(parsed.origin)) throwRagflowConfigInvalid();
  if (requiresProductionControls && isUnsafeNetworkHost(parsed.hostname)) throwRagflowConfigInvalid();
  if (isUnsafeNetworkHost(parsed.hostname) && (!allowPrivateEndpoint || !isExplicitPrivateEndpointHost(parsed.hostname))) throwRagflowConfigInvalid();
  return {
    baseUrl: parsed.href.replace(/\/+$/u, ""),
    origin: parsed.origin,
    tier,
    allowPrivateEndpoint
  };
}

function normalizeRagflowDeploymentTier(value) {
  const tier = stringValue(value).trim().toLowerCase();
  if (!tier || !RAGFLOW_DEPLOYMENT_TIERS.has(tier)) throwRagflowConfigInvalid();
  return tier;
}

function parseAllowedOrigins(value) {
  const origins = new Set();
  for (const item of stringValue(value).split(",")) {
    const raw = item.trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash) {
        origins.add(parsed.origin);
        continue;
      }
      throwRagflowConfigInvalid();
    } catch {
      throwRagflowConfigInvalid();
    }
  }
  return origins;
}

function throwRagflowConfigInvalid() {
  throw new ImageApiError({
    statusCode: 503,
    status: "failed",
    errorCode: "RAGFLOW_CONFIG_INVALID",
    message: "提示词优化服务配置无效。"
  });
}

function strictIntEnv(value, min, max, fallback) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throwRagflowConfigInvalid();
  return number;
}

function createDeadline(timeoutMs) {
  const expiresAt = Date.now() + timeoutMs;
  return {
    remainingMs() {
      return Math.max(0, expiresAt - Date.now());
    }
  };
}

class RagflowLookupTimeoutError extends Error {
  constructor() {
    super("RAGFlow DNS lookup timed out.");
    this.name = "RagflowLookupTimeoutError";
  }
}

async function lookupHostWithDeadline(lookupHost, hostname, options, deadline, dnsTimeoutMs) {
  const timeoutMs = Math.min(dnsTimeoutMs, deadline.remainingMs());
  if (timeoutMs <= 0) throw new RagflowLookupTimeoutError();
  const lookupPromise = Promise.resolve().then(() => lookupHost(hostname, options));
  lookupPromise.catch(() => {});
  let timer;
  try {
    return await Promise.race([
      lookupPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RagflowLookupTimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function validateRagflowEndpointForFetch(config, lookupHost, deadline = createDeadline(config.timeoutMs)) {
  const parsed = new URL(config.endpoint);
  if (parsed.origin !== config.approvedOrigin) throwRagflowConfigInvalid();
  if (isUnsafeNetworkHost(parsed.hostname) && (!config.allowPrivateEndpoint || !isExplicitPrivateEndpointHost(parsed.hostname))) throwRagflowConfigInvalid();
  if (isIpLiteral(parsed.hostname)) return { records: [] };

  let records;
  try {
    records = await lookupHostWithDeadline(lookupHost, parsed.hostname, { all: true, verbatim: true }, deadline, config.dnsTimeoutMs);
  } catch (error) {
    if (error && error.name === "RagflowLookupTimeoutError") throw error;
    throwRagflowConfigInvalid();
  }
  if (deadline.remainingMs() <= 0) {
    throw new RagflowLookupTimeoutError();
  }
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) throwRagflowConfigInvalid();
  for (const record of list) {
    const address = stringValue(record && record.address).trim();
    if (!address) throwRagflowConfigInvalid();
    if (isUnsafeNetworkHost(address) && (!config.allowPrivateEndpoint || !isExplicitPrivateEndpointHost(address))) throwRagflowConfigInvalid();
  }
  return {
    records: list.map((record) => ({
      address: stringValue(record.address).trim(),
      family: Number(record.family) === 6 ? 6 : 4
    }))
  };
}

function isIpLiteral(hostname) {
  const host = stringValue(hostname).replace(/^\[|\]$/g, "");
  return /^(\d{1,3}\.){3}\d{1,3}$/u.test(host) || host.includes(":");
}

function ragflowRequestHeaders(config) {
  const parsed = new URL(config.endpoint);
  if (parsed.origin !== config.approvedOrigin) throwRagflowConfigInvalid();
  return {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
}

function fetchRagflowWithPinnedLookup(url, init, resolution, maxResponseBytes) {
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
      lookup: makePinnedLookup(resolution.records)
    }, (incoming) => {
      const chunks = [];
      let total = 0;
      incoming.on("data", (chunk) => {
        const buffer = Buffer.from(chunk);
        total += buffer.length;
        if (total > maxResponseBytes) {
          const error = new Error("RAGFlow response exceeded byte limit.");
          error.name = "RagflowResponseLimitError";
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
            get: (name) => stringValue(incoming.headers[String(name || "").toLowerCase()] || "")
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

function getHeader(response, name) {
  if (!response || !response.headers || typeof response.headers.get !== "function") return "";
  return stringValue(response.headers.get(name)).trim();
}

function isJsonContentType(value) {
  return /^application\/(?:json|[\w.+-]+\+json)\b/i.test(stringValue(value));
}

async function readBoundedResponseText(response, maxBytes) {
  const contentLength = Number(getHeader(response, "content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) {
          if (typeof reader.cancel === "function") await reader.cancel();
          return null;
        }
        chunks.push(chunk);
      }
    } finally {
      if (typeof reader.releaseLock === "function") reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") > maxBytes ? null : text;
}

function parseBoundedJson(text, limits) {
  const parsed = parseJsonWithoutDuplicateKeys(text || "{}");
  if (!parsed.ok) return null;
  const json = parsed.value;
  return jsonWithinResourceLimits(json, limits) ? json : null;
}

function jsonWithinResourceLimits(value, limits) {
  const stack = [{ value, depth: 0 }];
  let keyCount = 0;
  let totalChars = 0;
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > limits.maxDepth) return false;
    const node = current.value;
    if (typeof node === "string") {
      if (node.length > limits.maxStringLength) return false;
      totalChars += node.length;
      if (totalChars > limits.maxTotalChars) return false;
      continue;
    }
    if (Array.isArray(node)) {
      if (node.length > limits.maxArrayLength) return false;
      for (const item of node) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (node && typeof node === "object") {
      const entries = Object.entries(node);
      keyCount += entries.length;
      if (keyCount > limits.maxKeys) return false;
      for (const [, item] of entries) stack.push({ value: item, depth: current.depth + 1 });
    }
  }
  return true;
}

function readRagflowRuntimeConfig(env = process.env) {
  const explicitConfigFile = stringValue(env.AI_TU_RUNTIME_CONFIG_FILE).trim();
  const candidates = explicitConfigFile
    ? [explicitConfigFile]
    : [resolve(ROOT, "真实配置_toapis.md")];
  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue;
      const json = parseRuntimeConfigText(readFileSync(filePath, "utf8"));
      return {
        baseUrl: json.ragflowBaseUrl,
        apiKey: json.ragflowApiKey,
        chatId: json.ragflowChatId,
        model: json.ragflowModel
      };
    } catch {
      continue;
    }
  }
  return {};
}

function ragflowSystemPrompt() {
  return [
    "你是影视级 AIGC 生图提示词增强器，只输出可选结构化 enhancement。",
    "不要输出最终 prompt，不要输出 final_prompt，不要输出 compiled_prompt。",
    "输出 JSON 对象，字段只能来自安全 allowlist，且只能包含当前 task_type 实际需要的字段；不确定时输出空对象。",
    "必须根据 task_type、raw_prompt、references[] 动态提供补充建议。",
    "不得新增 reference_id，不得新增图片 URL，不得改变后端确定的参考图绑定关系，不得把任何样例实体写死为规则。"
  ].join("");
}

function ragflowUserPrompt(request, binding, referencePlan) {
  const refs = binding.resolved_references || [];
  const referenceLines = refs.map((ref) => (
    `- ${mention(ref, ref.entity_type || "对象")}: entity_type=${ref.entity_type}, role=${ref.role}, description=${ref.description || ref.display_name || ""}`
  ));
  return [
    `task_type=${request.task_type}`,
    `raw_prompt=${request.prompt}`,
    `generation_mode=${referencePlan.generationMode}`,
    "",
    "references:",
    referenceLines.join("\n") || "* 无",
    "",
    "请输出 JSON enhancement。只给可选补充，不要生成最终生图 prompt。"
  ].join("\n");
}

export function parseRagflowOptimizedPrompt(json, limits = defaultJsonLimits()) {
  const candidates = extractPromptCandidates(json);
  for (const content of candidates) {
    const unwrapped = unwrapCodeFence(content);
    const parsed = parseJsonMaybe(unwrapped);
    if (parsed && typeof parsed === "object" && jsonWithinResourceLimits(parsed, limits)) return parsed;
  }
  return null;
}

function defaultJsonLimits() {
  return {
    maxDepth: RAGFLOW_MAX_JSON_DEPTH,
    maxKeys: RAGFLOW_MAX_JSON_KEYS,
    maxArrayLength: RAGFLOW_MAX_JSON_ARRAY_LENGTH,
    maxStringLength: RAGFLOW_MAX_JSON_STRING_LENGTH,
    maxTotalChars: RAGFLOW_MAX_ENHANCEMENT_CHARS
  };
}

export function validateRagflowEnhancement(candidate, context = {}) {
  if (!isPlainRecord(candidate)) return null;
  if ("final_prompt" in candidate || "compiled_prompt" in candidate || "internal_prompt" in candidate || "provider_payload" in candidate) return null;
  if (Object.keys(candidate).some((key) => !RAGFLOW_ALLOWED_FIELDS.has(key))) return null;
  if (Object.keys(candidate).some((key) => !consumedRagflowFieldsForTask(context.request?.task_type).has(key))) return null;
  if (hasUnsafeJsonObjectKeys(candidate, RAGFLOW_FORBIDDEN_CANONICAL_OUTPUT_KEYS)) return null;
  if (containsForbiddenEnhancementKey(candidate)) return null;
  const jsonText = JSON.stringify(candidate);
  if (jsonText.length > (context.maxChars || RAGFLOW_MAX_ENHANCEMENT_CHARS)) return null;
  for (const title of forbiddenPromptHeadings()) {
    if (jsonText.includes(title)) return null;
  }
  if (containsForbiddenEnhancementText(jsonText)) return null;
  if (containsSensitiveEnhancementString(candidate)) return null;

  const allowedReferenceIds = new Set((context.binding?.resolved_references || []).map((ref) => ref.reference_id));
  const foundReferenceIds = findValuesByKey(candidate, "reference_id");
  if (foundReferenceIds.some((id) => id && !allowedReferenceIds.has(id))) return null;
  const foundUrls = findUrls(candidate);
  if (foundUrls.length) return null;

  return sanitizeEnhancement(candidate);
}

function containsSensitiveEnhancementString(value) {
  let unsafe = false;
  walk(value, (node) => {
    if (unsafe || typeof node !== "string") return;
    unsafe = containsPromptOptimizationSensitivePayload(node);
  });
  return unsafe;
}

function consumedRagflowFieldsForTask(taskType) {
  return RAGFLOW_CONSUMED_FIELDS_BY_TASK[taskType] || RAGFLOW_CONSUMED_FIELDS_BY_TASK.text_image;
}

function sanitizeEnhancement(candidate) {
  const out = {};
  for (const key of [
    "scene_summary",
    "visual_focus",
    "story_function",
    "action_stages",
    "shot_plan",
    "normalized_shot_plan",
    "lighting_notes",
    "composition_notes",
    "negative_notes",
    "missing_constraints"
  ]) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 1200);
    if (Array.isArray(value)) {
      const arrayValue = value.slice(0, 24).map((item) => {
        if (typeof item === "string" && item.trim()) return item.slice(0, 400);
        if (item && typeof item === "object") {
          const cleaned = sanitizePlainObject(item);
          return Object.keys(cleaned).length ? cleaned : null;
        }
        return null;
      }).filter(Boolean);
      if (arrayValue.length) out[key] = arrayValue;
    }
  }
  return Object.keys(out).length ? out : null;
}

function sanitizePlainObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isForbiddenEnhancementKey(key)) continue;
    if (typeof item === "string") out[key] = item.slice(0, 240);
    else if (typeof item === "number" || typeof item === "boolean") out[key] = item;
  }
  return out;
}

function isForbiddenEnhancementKey(key) {
  return RAGFLOW_FORBIDDEN_CANONICAL_OUTPUT_KEYS.has(canonicalSchemaKey(key))
    || isForbiddenSchemaKey(key)
    || /^(?:final_prompt|compiled_prompt|internal_prompt|provider|model|images?|provider_payload|provider_internal_payload|provider_raw_payload|raw_provider_payload|raw_provider_response|reference_ids?|asset_ids?|callback_status|ragflow_status|fallback_status|authorization|cookie|bearer|token|secret|api[_-]?key|enhancement|primary|auxiliary|weight|priority|url|b64_json|base64|data_url)$/i.test(stringValue(key));
}

function containsForbiddenEnhancementKey(value) {
  let found = false;
  walkValue(value, (node) => {
    if (found || !node || typeof node !== "object" || Array.isArray(node)) return;
    if (Object.keys(node).some(isForbiddenEnhancementKey)) found = true;
  });
  return found;
}

export function compileOptimizedPrompt(context) {
  const { request } = context;
  switch (request.task_type) {
    case "text_image":
      return textImagePrompt(context);
    case "image_reference":
      return imageReferencePrompt(context);
    case "character_multiview":
      return characterMultiviewPrompt(context);
    case "scene_multiview":
      return sceneMultiviewPrompt(context);
    case "prop_multiview":
      return propMultiviewPrompt(context);
    case "storyboard":
      return storyboardPrompt(context);
    default:
      clarification("UNSUPPORTED_TASK_TYPE", "不支持的 task_type。");
  }
}

function textImagePrompt(context) {
  const theme = stripCommandPrefix(context.request.prompt);
  const guidance = enhancementText(context, ["visual_focus", "lighting_notes", "composition_notes", "missing_constraints"]);
  return [
    `生成一张完整高质量的普通文字生图作品，主题围绕“${theme}”。画面需要清楚表达用户原始意图，主体明确，动作或状态自然，环境信息完整，构图稳定，前景、中景和背景层次分明。`,
    `${guidance}根据主题补充合理的画面气氛、镜头距离、色彩关系、光源方向、明暗层次、材质质感和清晰度要求，但不要强行套用人物四视图、场景多视图、道具多视图或故事板结构，也不要新增未提供的具体实体。`,
    "整体风格写实精致、画面干净、空间可信、细节可辨，适合直接发送给图片生成模型。",
    "不要出现文字、水印、标签、UI 标识、畸形肢体、重复主体、低清晰度、过度虚化、空间错乱或与主题无关的元素。"
  ].filter(Boolean).join("\n\n");
}

function imageReferencePrompt(context) {
  const refs = context.referencePlan.allRefs;
  const theme = stripCommandPrefix(context.request.prompt);
  const referenceText = refs.map((ref) => `${mention(ref, ref.entity_type || "参考对象")} 用作${roleUsageText(ref)}，保持${ref.description || ref.display_name || "关键视觉特征"}`).join("；");
  const guidance = enhancementText(context, ["visual_focus", "lighting_notes", "composition_notes", "missing_constraints"]);
  return [
    `基于参考图生成一张新的完整图像，围绕“${theme}”组织主体、环境、构图、光影和材质。${referenceText}。`,
    `${guidance}参考图用于稳定主体特征、风格气质、构图关系、光影方向或材质细节；新画面可以根据提示词重新组织场景和镜头，但必须保持参考对象的关键视觉特征和绑定关系。`,
    "画面应是普通参考图生图结果，不要强行变成人物四视图、场景多视图、道具多视图或故事板。构图完整，主体边界清晰，材质细节可辨，光源统一。不要机械复制参考图，不要改变参考对象身份，不要混淆多个参考对象，不要新增未提供的参考对象，不要出现文字、水印、标签、畸形结构、低清晰度或风格断裂。"
  ].filter(Boolean).join("\n\n");
}

function characterMultiviewPrompt(context) {
  if (!hasProfessionalDetailSource(context, /四视图|4\s*格|正面|侧面|背面|头部特写|角色设定图/u)) {
    return minimalCharacterMultiviewPrompt(context);
  }
  const plan = context.referencePlan;
  const character = characterTaskRefs(plan);
  const name = namesText(character, mentionFromRaw(context.request.prompt, "角色"));
  const referenceText = roleRefsText(plan, character);
  const guidance = enhancementText(context, ["visual_focus", "composition_notes", "missing_constraints"]);
  return [
    `生成一张人物多视角图，也就是角色四视图 / 角色设定图 / 人物一致性参考图，以 ${name} 作为角色主交付物。${name} 必须保持身份、五官特征、发型、服饰结构、身体比例、色彩搭配和整体气质稳定一致。`,
    `${referenceText ? `参考图等权使用：${referenceText}。按 role 将参考图用于脸部、角色、服装、发型、道具、场景、风格、构图或光影约束，不要改变用户指定的参考绑定。` : ""}${guidance}`,
    "画面必须采用 4 格横向布局：第一格为正面全身站姿，第二格为正面头部特写，第三格为侧面全身站姿，第四格为背面全身站姿。所有全身视图都必须头到脚完整，鞋子完整可见，A 字站姿，双手自然下垂或微微张开，手上无道具，比例统一，服装轮廓和细节在不同视角中保持一致。",
    "背景使用纯色背景或极简浅色背景，光线均匀，人物轮廓清晰，适合角色建模、角色一致性训练、后续 AIGC 角色复用和美术设定交付。",
    "不要生成普通人物写真、单张立绘、单一视角或剧情图；不要只有正面、缺侧面、缺背面、多个头部特写、手持武器或道具、复杂剧情背景抢主体；不要出现文字、水印、标签、UI 标识、畸形肢体、错乱五官、重复脸、低清晰度或服装前后不一致。"
  ].filter(Boolean).join("\n\n");
}

function sceneMultiviewPrompt(context) {
  if (!hasProfessionalDetailSource(context, /3×3|3x3|九宫格|多机位|全景|中景|俯视|平面布局|材质特写|场景设定参考板/u)) {
    return minimalSceneMultiviewPrompt(context);
  }
  const plan = context.referencePlan;
  const sceneRefs = sceneTaskRefs(plan);
  const sceneName = namesText(sceneRefs, mentionFromRaw(context.request.prompt, "场景"));
  const referenceText = roleRefsText(plan);
  const characterText = namesText(plan.characterRefs, "");
  const nonCharacterText = roleRefsText({
    ...plan,
    allRefs: plan.allRefs.filter((ref) => !isCharacterReference(ref))
  });
  const theme = stripCommandPrefix(context.request.prompt);
  const guidance = enhancementText(context, ["scene_summary", "visual_focus", "lighting_notes", "composition_notes", "missing_constraints"]);
  const characterSentence = characterText
    ? `${characterText} 作为角色参考进入场景，用于空间尺度锚点、站位锚点、行动调度锚点和互动关系参照，不作为人物主图，不喧宾夺主。`
    : "";
  const nonCharacterSentence = nonCharacterText
    ? `其他参考按其 role 表达为场景、局部物件、风格、光影或构图约束：${nonCharacterText}，不得强行改写为角色尺度。`
    : "";
  const characterNegative = plan.characterRefs.length
    ? "不要让辅助角色喧宾夺主，不要生成角色立绘式主图，"
    : "";
  return [
    `生成一套围绕 ${sceneName} 的影视级 / AIGC 场景多视图参考板。最终交付物围绕“${theme}”展开，必须是场景多机位、空间关系、现场光影和氛围参考板，不是单张场景美图，也不是人物主图。所有 references[] 等权使用，必须按各自 role 保持空间结构、区域布局、材质层次、结构细节、光影方向、角色关系和构图逻辑稳定一致。`,
    `${referenceText ? `参考图集合包括 ${referenceText}。` : ""}${characterSentence}${nonCharacterSentence}${guidance}`,
    "场景元素只做类别级补全：空间结构、区域布局、主要陈设、可见材质、关键区域、结构细节、光影方向、空间纵深、局部物件和环境元素。不要主动脑补具体物件，除非它来自原始提示词、reference 名称、reference 描述或合格增强信息。",
    `采用 3×3 或等价多视图 / 多机位 / 场景设定参考板结构：全景镜头展示 ${sceneName} 的整体空间关系；中景镜头展示关键区域和参考对象的尺度关系；陈设特写展示主要陈设与局部物件；装饰 / 结构特写展示可见结构细节；材质特写展示表面质感和材质层次；关键区域 / 局部特写展示空间功能和行动锚点；俯视全景展示区域分布；平面布局图展示入口、动线、尺度和空间关系；分镜示意图展示现场调度、光线方向和镜头衔接。`,
    "整体风格为写实影视概念设计，画面清晰，空间信息稳定，主体关系明确，光影层次丰富，材质细节可辨。重点服务场景资产设计、现场光影设计、多机位分镜参考和后续 AIGC 场景复用。",
    `严格遵守参考绑定，不要混淆实体身份，不要改变 reference_id 与实体的绑定关系，不要新增未提供的参考对象，${characterNegative}不要出现文字、水印、标签、重复主体、畸形肢体、低清晰度、过度虚化、空间错乱或互相矛盾的场景结构。`
  ].filter(Boolean).join("\n\n");
}

function propMultiviewPrompt(context) {
  if (!hasProfessionalDetailSource(context, /正面|侧面|背面|顶部|底部|结构拆解|材质特写|多角度|资产参考板/u)) {
    return minimalPropMultiviewPrompt(context);
  }
  const plan = context.referencePlan;
  const prop = propTaskRefs(plan);
  const name = namesText(prop, mentionFromRaw(context.request.prompt, "主道具"));
  const referenceText = roleRefsText(plan);
  const guidance = enhancementText(context, ["visual_focus", "composition_notes", "missing_constraints"]);
  return [
    `生成一张道具多视图资产参考板，也是一套道具资产 / 多角度资产图，以 ${name} 作为道具主交付物，最终呈现道具结构、材质、纹样和多角度资产图，不是普通产品图，也不是单张道具美图。${name} 必须保持轮廓、体块、比例、连接结构、开合结构、边缘结构、可活动部件、装饰位置、局部细节和材质层次稳定一致。`,
    `${referenceText ? `参考图等权使用：${referenceText}。角色或场景参考用于比例参照、使用语境、摆放关系或动作语境；材质和纹样参考用于表面质感与装饰位置，不改变用户指定绑定。` : ""}${guidance}`,
    "画面必须覆盖整体视图、正面视图、侧面视图、背面视图、顶部 / 底部视图、结构拆解、材质特写、纹样 / 工艺特写、比例参照和使用场景参考。每个视图都服务于建模、绘制、材质还原和资产复用。",
    "重点展示道具轮廓、体块关系、尺寸比例、连接部位、边缘厚度、活动结构、装饰分布、表面纹理、磨损层次、材质差异和局部工艺。背景保持简洁，辅助对象只解释尺度和使用关系。",
    "不要生成角色立绘、场景多视图或故事板；不要改变参考道具的核心外形，不要新增未提供的道具，不要让人物或背景喧宾夺主，不要出现文字、水印、标签、比例错乱、材质混淆、结构前后矛盾、低清晰度或单一角度展示。"
  ].filter(Boolean).join("\n\n");
}

function storyboardPrompt(context) {
  if (!hasProfessionalDetailSource(context, /左侧规划区|右侧剧情宫格|剧情宫格|shot\s*\d+|镜头\s*\d+|完整故事板|分镜制作板/u)) {
    return minimalStoryboardPrompt(context);
  }
  const plan = context.referencePlan;
  const refsText = plan.allRefs.length ? `参考对象保持绑定稳定：${plan.allRefs.map((ref) => `${mention(ref, ref.entity_type || "对象")} 用作${roleUsageText(ref)}`).join("；")}。` : "";
  const shotCount = detectShotCount(context.request.prompt);
  const shotText = shotCount ? `如果输入中已有 shot 清单，右侧剧情宫格区必须保持原 ${shotCount} 个 shot 的数量、顺序和核心动作，只补景别、运镜、光影、布局和负向约束，不重拆、不重排、不合并、不删除。` : "右侧剧情宫格区根据实际剧情动作阶段自适应生成分镜数量，宫格数量等于实际 shot 数量。";
  const guidance = enhancementText(context, ["story_function", "action_stages", "lighting_notes", "composition_notes", "missing_constraints"]);
  return [
    `生成一张影视级剧情故事板制作图，围绕“${stripCommandPrefix(context.request.prompt)}”制作剧情宫格电影分镜制作板。它不是普通漫画分镜，不是固定九宫格，不是单张剧情图。`,
    "画面必须包含左侧规划区和右侧剧情宫格区。左侧规划区包含场景走位示意图、氛围概念图、光影变化示意、空间关系、人物动线和镜头调度，用来说明分镜执行逻辑。",
    `${shotText}不要固定九宫格，不要固定 2×2，不要固定 3×3，不限制 shot 数量，不限制总时长。右侧每个剧情宫格都要清楚表达景别、构图、人物关系、动作阶段、光影变化、镜头调度和剧情推进。`,
    `${refsText}${guidance}如果输入是剧情段落、对白片段或原始剧本，则根据动作阶段自适应拆分；如果输入是半结构化分镜或完整 storyboard prompt，则保留用户原有核心结构并补足左侧规划区、右侧剧情宫格、镜头调度、光影和负向规则。`,
    "整体清晰可读，适合导演、分镜、美术和 AIGC 视频制作复用。不要把故事板做成场景 3×3 参考板，不要限制总时长，不要省略左侧规划区或右侧剧情宫格区，不要出现文字水印、无关标签、镜头顺序混乱、空间跳变、人物身份混淆、动作顺序错误或低清晰度。"
  ].filter(Boolean).join("\n\n");
}

function minimalCharacterMultiviewPrompt(context) {
  const plan = context.referencePlan;
  const character = characterTaskRefs(plan);
  const name = namesText(character, mentionFromRaw(context.request.prompt, "角色"));
  const referenceText = roleRefsText(plan);
  return [
    `生成一张以 ${name} 为主体的角色一致性参考图，围绕“${stripCommandPrefix(context.request.prompt)}”保留用户原始意图、角色身份、外观气质、服饰轮廓和可见特征。`,
    referenceText ? `参考图按既有绑定使用：${referenceText}。只根据参考图已提供的信息稳定身份和视觉特征，不新增参考对象，不改变 reference_id 与实体的绑定关系。` : "未提供角色参考图时，只根据用户文字描述组织角色一致性提示，不主动补充未说明的具体服装、发型、道具或身份背景。",
    "输出应适合直接作为角色参考图提示词使用，主体清楚，比例自然，画面干净，光线稳定，细节服务于角色一致性。不要生成无关实体、文字、水印、标签、畸形肢体、重复脸、低清晰度或与用户题材冲突的元素。"
  ].filter(Boolean).join("\n\n");
}

function minimalSceneMultiviewPrompt(context) {
  const plan = context.referencePlan;
  const sceneRefs = sceneTaskRefs(plan);
  const sceneName = namesText(sceneRefs, mentionFromRaw(context.request.prompt, "场景"));
  const referenceText = roleRefsText(plan);
  return [
    `生成一张围绕 ${sceneName} 的场景一致性参考图，主题为“${stripCommandPrefix(context.request.prompt)}”。画面需要保留用户指定的空间身份、氛围、主体关系和行动语境。`,
    referenceText ? `参考图按既有绑定使用：${referenceText}。只根据参考图和原始提示中的信息稳定空间结构、材质倾向、光影方向和实体关系，不新增未提供的参考对象。` : "未提供场景参考图时，只根据用户文字描述组织场景提示，不主动补充具体物件清单、固定机位数量或固定版式。",
    "输出应适合直接作为场景参考提示词使用，空间可信，主体关系明确，光影统一，前后景层次清楚。不要让角色或道具喧宾夺主，不要出现文字、水印、标签、重复主体、低清晰度、空间错乱或互相矛盾的场景结构。"
  ].filter(Boolean).join("\n\n");
}

function minimalPropMultiviewPrompt(context) {
  const plan = context.referencePlan;
  const prop = propTaskRefs(plan);
  const name = namesText(prop, mentionFromRaw(context.request.prompt, "主道具"));
  const referenceText = roleRefsText(plan);
  return [
    `生成一张以 ${name} 为主体的道具一致性参考图，围绕“${stripCommandPrefix(context.request.prompt)}”保留用户原始意图、道具身份、轮廓、材质倾向、比例关系和可见细节。`,
    referenceText ? `参考图按既有绑定使用：${referenceText}。只根据参考图已提供的信息稳定道具外形和视觉特征，不新增未提供的道具，不改变绑定关系。` : "未提供道具参考图时，只根据用户文字描述组织道具提示，不主动补充固定视角、拆解结构或具体工艺细节。",
    "输出应适合直接作为道具资产提示词使用，道具主体清晰，边界明确，材质可辨，背景简洁。不要生成角色立绘、场景主图、无关物件、文字、水印、标签、比例错乱、材质混淆、结构前后矛盾或低清晰度结果。"
  ].filter(Boolean).join("\n\n");
}

function minimalStoryboardPrompt(context) {
  const plan = context.referencePlan;
  const refsText = plan.allRefs.length ? `参考对象保持既有绑定：${plan.allRefs.map((ref) => `${mention(ref, ref.entity_type || "对象")} 用作${roleUsageText(ref)}`).join("；")}。` : "";
  return [
    `生成一张围绕“${stripCommandPrefix(context.request.prompt)}”的故事板分镜参考图，保留用户原始剧情意图、角色身份、场景关系、动作顺序和情绪推进。`,
    `${refsText}根据原文已经给出的动作阶段组织镜头表达，不重排、不删除、不合并用户明确写出的情节或 shot；如果原文没有明确 shot 清单，只做自然的分镜化表达，不固定九宫格、2×2、3×3、固定时长或固定镜头数量。`,
    "输出应适合直接作为故事板提示词使用，镜头关系清楚，动作连续，空间方向稳定，光影和构图服务叙事。不要新增未提供的剧情实体、改变人物身份、打乱动作顺序、出现文字水印、无关标签、空间跳变或低清晰度结果。"
  ].filter(Boolean).join("\n\n");
}

function hasProfessionalDetailSource(context, explicitPattern) {
  if (context.enhancement && Object.keys(context.enhancement).length) return true;
  return explicitPattern.test(stringValue(context.request && context.request.prompt));
}

export function validateOptimizedPrompt(prompt, context = {}) {
  const text = stringValue(prompt).trim();
  if (!text || countCjk(text) < PROMPT_MIN_CJK) throw optimizedPromptInvalid();
  for (const title of forbiddenPromptHeadings()) {
    if (text.includes(title)) throw optimizedPromptInvalid();
  }
  if (containsForbiddenOptimizedPromptText(text)) {
    throw optimizedPromptInvalid();
  }

  const request = context.request || {};
  const plan = context.referencePlan || buildReferencePlan(context.binding || {});
  if (request.task_type === "text_image") validateTextImagePrompt(text);
  if (request.task_type === "image_reference") validateImageReferencePrompt(text, plan);
  if (request.task_type === "character_multiview") validateCharacterMultiviewPrompt(text, plan);
  if (request.task_type === "scene_multiview") validateSceneMultiviewPrompt(text, plan);
  if (request.task_type === "prop_multiview") validatePropMultiviewPrompt(text, plan);
  if (request.task_type === "storyboard") validateStoryboardPrompt(text);
  return text;
}

function validateTextImagePrompt(text) {
  if (/(必须采用 4 格横向布局|采用 3×3|左侧规划区和右侧剧情宫格区|道具多视图资产参考板|场景设定参考板结构)/u.test(text)) throw optimizedPromptInvalid();
}

function validateImageReferencePrompt(text, plan) {
  if (!/(基于参考图|参考图生成|保持参考|参考对象|关键视觉特征)/u.test(text)) throw optimizedPromptInvalid();
  for (const name of plan.allEntityNames || []) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (/(必须采用 4 格横向布局|采用 3×3|左侧规划区和右侧剧情宫格区|道具多视图资产参考板|场景设定参考板结构)/u.test(text)) throw optimizedPromptInvalid();
}

function validateCharacterMultiviewPrompt(text, plan) {
  for (const name of requiredNames(plan.characterRefs)) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (!/(人物多视角|四视图|角色设定图|人物一致性参考图|角色一致性参考图|角色参考图)/u.test(text)) throw optimizedPromptInvalid();
  if (/(场景多视图|道具多视图|剧情宫格|左侧规划区|右侧剧情宫格区)/u.test(text)) throw optimizedPromptInvalid();
}

function validateSceneMultiviewPrompt(text, plan = {}) {
  if (!/(场景多视图|多机位|多视图|现场光影参考图|场景设定参考板|场景设定板|场景一致性参考图|场景参考提示词)/u.test(text)) throw optimizedPromptInvalid();
  for (const name of plan.allEntityNames || []) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (/(角色四视图|道具多视图|剧情宫格|左侧规划区|右侧剧情宫格区)/u.test(text)) throw optimizedPromptInvalid();
}

function validatePropMultiviewPrompt(text, plan) {
  for (const name of requiredNames(plan.propRefs || [])) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (!/(道具多视图|道具资产|多角度资产图|资产参考板|道具一致性参考图|道具资产提示词)/u.test(text)) throw optimizedPromptInvalid();
  if (/(必须采用 4 格横向布局|场景设定参考板结构|左侧规划区和右侧剧情宫格区)/u.test(text)) throw optimizedPromptInvalid();
}

function validateStoryboardPrompt(text) {
  for (const word of ["故事板", "分镜"]) {
    if (!text.includes(word)) throw optimizedPromptInvalid();
  }
  if (!/(不固定九宫格|不要固定九宫格)/u.test(text)) throw optimizedPromptInvalid();
  if (/采用 3×3 或等价多视图/u.test(text)) throw optimizedPromptInvalid();
}

export function buildPromptOptimizationResponse({ request, context, optimizedPrompt, traceId }) {
  const payload = {
    status: "succeeded",
    request_id: request.request_id,
    optimization_id: makeId("opt"),
    task_type: request.task_type,
    task_type_label: taskTypeLabel(request.task_type),
    generation_mode: context.referencePlan.generationMode,
    optimized_prompt: optimizedPrompt,
    normalized: {
      entity_mentions: context.binding.entity_mentions,
      references_used: context.binding.references_used
    },
    warnings: context.binding.warnings,
    trace_id: traceId
  };
  assertNoForbiddenPublicFields(payload);
  assertPromptOptimizationPublicPayload(payload, "success");
  return payload;
}

function assertPromptOptimizationPublicPayload(payload, kind) {
  const allowed = kind === "success" ? PROMPT_PUBLIC_SUCCESS_FIELDS : PROMPT_PUBLIC_ERROR_FIELDS;
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      fail("INTERNAL_ERROR", "公共响应包含非正式字段。", 500);
    }
  }
  walk(payload, (node) => {
    if (node == null) return;
    if (typeof node === "string") {
      if (containsForbiddenPublicText(node)) {
        fail("INTERNAL_ERROR", "公共响应包含内部信息。", 500);
      }
      return;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      const canonical = canonicalSchemaKey(key);
      if (PROMPT_PUBLIC_FORBIDDEN_KEY.test(key) || PROMPT_PUBLIC_FORBIDDEN_KEY.test(canonical) || FORBIDDEN_CANONICAL_SCHEMA_KEYS.has(canonical)) {
        fail("INTERNAL_ERROR", "公共响应包含内部字段。", 500);
      }
    }
  });
}

function containsForbiddenEnhancementText(text) {
  return containsPatternInScanCopies(RAGFLOW_FORBIDDEN_STRUCTURAL_TEXT, text)
    || containsPatternInScanCopies(RAGFLOW_FORBIDDEN_INTERNAL_MARKER_TEXT, text)
    || containsPromptOptimizationSensitivePayload(text);
}

function containsForbiddenOptimizedPromptText(text) {
  const value = stringValue(text);
  return containsPatternInScanCopies(PROMPT_OPTIMIZER_FORBIDDEN_OUTPUT_TEXT, value)
    || containsHiddenInternalMarkerText(value)
    || containsPromptOptimizationPublicSensitivePayload(value);
}

function containsForbiddenPublicText(text) {
  const value = stringValue(text);
  if (/^RAGFLOW_(?:CONFIG_INVALID|OPENAI_ENDPOINT_NOT_FOUND|OPTIMIZER_FAILED)$/u.test(value)) return false;
  return containsPatternInScanCopies(PROMPT_PUBLIC_FORBIDDEN_TEXT, value)
    || containsHiddenInternalMarkerText(value)
    || containsPromptOptimizationPublicSensitivePayload(value);
}

function containsPatternInScanCopies(pattern, value) {
  const original = stringValue(value);
  if (testPattern(pattern, original)) return true;
  const normalized = normalizeTextForSensitiveScan(original);
  return normalized !== original && testPattern(pattern, normalized);
}

function containsHiddenInternalMarkerText(value) {
  const original = stringValue(value);
  const normalized = normalizeTextForSensitiveScan(original);
  return normalized !== original
    && !testPattern(PROMPT_HIDDEN_INTERNAL_MARKER_TEXT, original)
    && testPattern(PROMPT_HIDDEN_INTERNAL_MARKER_TEXT, normalized);
}

function testPattern(pattern, value) {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function containsPromptOptimizationPublicSensitivePayload(value) {
  const text = stringValue(value);
  if (!text) return false;
  return containsHighConfidenceSensitivePayload(text);
}

export function buildReferencePlan(input = {}) {
  const refs = Array.isArray(input.resolved_references)
    ? input.resolved_references
    : Array.isArray(input.references)
      ? input.references
      : [];
  const allRefs = refs.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const characterRefs = allRefs.filter(isCharacterReference);
  const sceneRefs = allRefs.filter(isSceneReference);
  const propRefs = allRefs.filter(isPropReference);
  const styleRefs = allRefs.filter(isStyleReference);
  const lightingRefs = allRefs.filter(isLightingReference);
  const compositionRefs = allRefs.filter(isCompositionReference);
  const visualGuidanceRefs = allRefs.filter((ref) => isStyleReference(ref) || isLightingReference(ref) || isCompositionReference(ref));
  const entityMentions = input.entity_mentions || input.request?.entity_mentions || [];
  const unboundMentions = entityMentions.filter((mention) => mention.reference_status === "unbound");
  return {
    allRefs,
    characterRefs,
    sceneRefs,
    propRefs,
    styleRefs,
    lightingRefs,
    compositionRefs,
    visualGuidanceRefs,
    allEntityNames: uniqueNames(allRefs),
    entityMentions,
    resolvedReferences: allRefs,
    unboundMentions,
    generationMode: allRefs.length ? "image_to_image" : "text_to_image"
  };
}

function sceneTaskRefs(plan) {
  if (plan.sceneRefs.length) return plan.sceneRefs;
  return plan.allRefs || [];
}

function characterTaskRefs(plan) {
  if (plan.characterRefs.length) return plan.characterRefs;
  return plan.allRefs || [];
}

function propTaskRefs(plan) {
  if (plan.propRefs.length) return plan.propRefs;
  return plan.allRefs || [];
}

function uniqueNames(refs) {
  const names = refs.map((ref) => stringValue(ref && ref.entity_name).trim()).filter(Boolean);
  return [...new Set(names)];
}

function requiredNames(refs) {
  return uniqueNames(refs || []);
}

function namesText(refs, fallback) {
  const names = uniqueNames(refs || []);
  if (!names.length) return fallback;
  return names.map((name) => name.startsWith("@") ? name : `@${name}`).join("、");
}

function roleRefsText(plan, excludeRefs = []) {
  const excluded = new Set((excludeRefs || []).map((ref) => ref.reference_id));
  return (plan.allRefs || [])
    .filter((ref) => !excluded.has(ref.reference_id))
    .map((ref) => `${mention(ref, ref.entity_type || "参考对象")}（${roleUsageText(ref)}${ref.description ? `，${ref.description}` : ""}）`)
    .join("、");
}

function isSceneReference(ref) {
  return ref && (ref.entity_type === "scene" || ref.role === "scene_reference");
}

function isCharacterReference(ref) {
  return ref && (ref.entity_type === "character" || ref.entity_type === "outfit" || ref.entity_type === "hair" || ["character_reference", "face_reference", "outfit_reference", "hair_reference"].includes(ref.role));
}

function isPropReference(ref) {
  return ref && (ref.entity_type === "prop" || ref.role === "prop_reference" || isMaterialReference(ref) || isPatternReference(ref));
}

function isMaterialReference(ref) {
  return ref && (ref.entity_type === "material" || ref.role === "material_reference");
}

function isPatternReference(ref) {
  return ref && (ref.entity_type === "ornament" || ref.role === "ornament_reference");
}

function isStyleReference(ref) {
  return ref && (ref.entity_type === "style" || ref.role === "style_reference");
}

function isLightingReference(ref) {
  return ref && (ref.entity_type === "lighting" || ref.role === "lighting_reference");
}

function isCompositionReference(ref) {
  return ref && (ref.entity_type === "composition" || ref.role === "composition_reference");
}

function includesEntityName(text, name) {
  const value = stringValue(name).trim();
  return Boolean(value && (text.includes(value) || text.includes(`@${value.replace(/^@/u, "")}`)));
}

function mention(ref, fallback) {
  const name = stringValue(ref && ref.entity_name).trim() || fallback;
  return name.startsWith("@") ? name : `@${name}`;
}

function mentionFromRaw(prompt, fallback) {
  const mentions = extractEntityMentions(prompt);
  return mentions[0]?.entity_name ? `@${mentions[0].entity_name}` : fallback;
}

function roleUsageText(ref) {
  if (!ref) return "视觉参考";
  if (ref.role === "scene_reference") return "场景参考";
  if (ref.role === "face_reference") return "脸部参考";
  if (ref.role === "character_reference") return "角色参考";
  if (ref.role === "outfit_reference") return "服装 / 造型参考";
  if (ref.role === "hair_reference") return "发型参考";
  if (ref.role === "prop_reference") return "道具参考";
  if (ref.role === "material_reference") return "材质参考";
  if (ref.role === "ornament_reference") return "纹样 / 装饰参考";
  if (ref.role === "style_reference") return "风格参考";
  if (ref.role === "lighting_reference") return "光影参考";
  if (ref.role === "composition_reference") return "构图参考";
  if (ref.role === "storyboard_reference") return "故事板参考";
  return "视觉参考";
}

function enhancementText(context, keys) {
  const enhancement = context.enhancement || {};
  const parts = [];
  for (const key of keys) {
    const value = enhancement[key];
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    if (Array.isArray(value)) {
      const values = value.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? Object.values(item).filter((v) => typeof v === "string").join("，") : "").filter(Boolean);
      if (values.length) parts.push(values.join("；"));
    }
  }
  return parts.length ? `${parts.join("。")}。` : "";
}

function detectShotCount(prompt) {
  const matches = stringValue(prompt).match(/(?:shot|镜头)\s*\d+/giu);
  return matches ? new Set(matches.map((item) => item.toLowerCase())).size : 0;
}

function findValuesByKey(value, key) {
  const out = [];
  walkValue(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (typeof node[key] === "string") out.push(node[key]);
  });
  return out;
}

function findUrls(value) {
  const out = [];
  walkValue(value, (node) => {
    if (typeof node !== "string") return;
    const matches = node.match(/(?:https?|ftp|file|data|javascript|blob):[^\s"'<>]*|\/\/[^\s"'<>]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|cn|io|ai|dev|app|local|localhost|example)(?:[/:?#][^\s"'<>]*)?/giu);
    if (matches) out.push(...matches);
  });
  return out;
}

function walkValue(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walkValue(item, visitor);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkValue(item, visitor);
  }
}

function isRagflowErrorEnvelope(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  if (Array.isArray(json.choices)) return false;
  if (!Object.prototype.hasOwnProperty.call(json, "code")) return false;
  return Number(json.code) !== 0;
}

function extractPromptCandidates(json) {
  const candidates = [];
  const push = (value) => {
    if (typeof value === "string" && value.trim()) candidates.push(value.trim());
  };

  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  push(choice && choice.message && choice.message.content);
  push(choice && choice.delta && choice.delta.content);
  push(choice && choice.text);

  push(json && json.optimized_prompt);
  push(json && json.answer);
  push(json && json.content);
  push(json && json.message);
  push(json && json.response);
  push(json && json.data && json.data.optimized_prompt);
  push(json && json.data && json.data.answer);
  push(json && json.data && json.data.content);
  push(json && json.data && json.data.message);
  push(json && json.data && json.data.response);

  if (!Array.isArray(json?.choices) && Object.keys(json || {}).length) candidates.push(JSON.stringify(json));
  return [...new Set(candidates)];
}

function unwrapCodeFence(value) {
  const text = stringValue(value).trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match ? match[1].trim() : text;
}

function parseJsonMaybe(value) {
  const text = stringValue(value).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  const parsed = parseJsonWithoutDuplicateKeys(text);
  return parsed.ok ? parsed.value : null;
}

function forbiddenPromptHeadings() {
  return [
    "任务类型：",
    "原始需求：",
    "参考绑定：",
    "优化方向：",
    "画面要求：",
    "负向约束：",
    "task_type:",
    "references:",
    "reference binding:",
    "optimization direction:",
    "negative constraints:"
  ];
}

function countCjk(value) {
  const matches = stringValue(value).match(/[\u3400-\u9fff]/gu);
  return matches ? matches.length : 0;
}

function optimizedPromptInvalid() {
  return new ImageApiError({
    statusCode: 422,
    status: "failed",
    errorCode: "OPTIMIZED_PROMPT_INVALID",
    message: "提示词优化结果不合格，请重新优化。"
  });
}

function stripCommandPrefix(prompt) {
  return stringValue(prompt).trim().replace(/^请?(生成|绘制|制作|设计)\s*/u, "").replace(/[。.\s]+$/u, "");
}
