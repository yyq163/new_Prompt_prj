import { randomBytes, randomUUID, createHash } from "node:crypto";
import { clarification, fail } from "./errors.js";
import { VALID_TASK_TYPES } from "./labels.js";

export const TYPE_SCHEMAS = Object.freeze({
  ImageGenerationRequest: {
    fields: ["request_id", "task_type", "prompt", "references", "reference_policy", "output", "options"]
  },
  ImageGenerationResponse: {
    fields: ["request_id", "generation_id", "status", "task_type", "task_type_label", "generation_mode", "input", "images", "normalized", "warnings", "trace_id"]
  },
  ReferenceInput: {
    fields: ["reference_id", "entity_name", "entity_type", "role", "usage", "url", "mime_type", "display_name", "description", "order"]
  },
  EntityMention: {
    fields: ["mention_id", "marker", "entity_name", "reference_status", "matched_reference_ids"]
  },
  ResolvedReference: {
    fields: ["reference_id", "entity_name", "entity_type", "role", "role_label", "usage", "url", "order"]
  },
  ReferencePolicy: {
    fields: ["unbound_entity", "duplicate_entity_role"]
  },
  GenerationImage: {
    fields: ["image_id", "url", "width", "height", "format"]
  },
  ProviderAdapterResult: {
    fields: ["status", "images"]
  },
  RagflowEnhancement: {
    fields: ["scene_summary", "visual_focus", "story_function", "action_stages", "shot_plan", "normalized_shot_plan", "lighting_notes", "composition_notes", "negative_notes", "input_analysis", "storyboard_processing"]
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
  "ragflow_status",
  "RAGFlow_status",
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
  if ("callback_url" in body || "callback" in body) {
    fail("CALLBACK_NOT_IMPLEMENTED", "当前版本不实现 callback。");
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
  const requestId = stringValue(body.request_id).trim() || makeId("req");

  return {
    request_id: requestId,
    task_type: taskType,
    prompt,
    references,
    reference_policy: referencePolicy,
    output,
    options,
    generation_mode: references.length ? "image_to_image" : "text_to_image"
  };
}

function normalizeReference(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    fail("INVALID_REQUEST_SCHEMA", `第 ${index + 1} 个 reference 必须是对象。`);
  }
  return {
    reference_id: stringValue(item.reference_id).trim(),
    entity_name: stringValue(item.entity_name).trim(),
    entity_type: stringValue(item.entity_type).trim() || "other",
    role: stringValue(item.role).trim(),
    usage: stringValue(item.usage).trim(),
    url: stringValue(item.url).trim(),
    mime_type: stringValue(item.mime_type).trim(),
    display_name: stringValue(item.display_name).trim(),
    description: stringValue(item.description).trim(),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1
  };
}

function normalizeReferencePolicy(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const unbound = source.unbound_entity === "block" ? "block" : "warn";
  const duplicate = source.duplicate_entity_role === "warn" ? "warn" : "block";
  return {
    unbound_entity: unbound,
    duplicate_entity_role: duplicate
  };
}

function normalizeOutput(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    count: intRange(source.count, 1, 16, 1),
    aspect_ratio: stringValue(source.aspect_ratio).trim() || "1:1",
    quality: stringValue(source.quality).trim() || "high",
    return_format: "url",
    language: stringValue(source.language).trim() || "zh-CN",
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : null
  };
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
