import { walk } from "./runtime.js";

const DEFAULT_MAX_ENHANCEMENT_CHARS = 12000;
const INTERNAL_TERMS = /RAGFlow|fallback|兜底|本地模板|compiled_prompt|final_prompt|provider_internal_payload/i;
const BINDING_DECISION_TERMS = /primary|auxiliary|main\s*reference|secondary\s*reference|weight(?:ed|ing)?|priority|主参考|辅参考|主图|辅图|主辅|权重|优先级/i;

export async function getRagflowEnhancement({ request, binding, timeoutMs = 6000, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = String(process.env.RAGFLOW_ENHANCEMENT_URL || "").trim();
  if (!endpoint) return { enhancement: null, discarded: "not_configured" };
  if (!/^https?:\/\//i.test(endpoint)) return { enhancement: null, discarded: "invalid_endpoint" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_type: request.task_type,
        prompt: request.prompt,
        entity_mentions: binding.entity_mentions,
        resolved_references: binding.references_used,
        output: request.output
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) return { enhancement: null, discarded: "ragflow_failed" };
    return validateEnhancement(text, { request, binding });
  } catch {
    return { enhancement: null, discarded: "ragflow_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export function validateEnhancement(raw, { request, binding, maxChars = DEFAULT_MAX_ENHANCEMENT_CHARS } = {}) {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > maxChars) return { enhancement: null, discarded: "too_long" };
    try {
      value = JSON.parse(raw);
    } catch {
      return { enhancement: null, discarded: "non_json" };
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { enhancement: null, discarded: "not_object" };
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) return { enhancement: null, discarded: "too_long" };

  if (containsForbiddenPromptField(value)) return { enhancement: null, discarded: "prompt_leak" };
  if (containsUnauthorizedReference(value, binding)) return { enhancement: null, discarded: "unauthorized_reference" };
  if (containsUnauthorizedUrl(value, binding)) return { enhancement: null, discarded: "unauthorized_url" };
  if (containsBindingDecision(value)) return { enhancement: null, discarded: "binding_decision" };
  if (!validStoryboardShape(value)) return { enhancement: null, discarded: "invalid_storyboard_shape" };
  if (!preservesShotList(value, request)) return { enhancement: null, discarded: "shot_plan_changed" };
  if (typeof value.negative_notes === "string" && INTERNAL_TERMS.test(value.negative_notes)) {
    return { enhancement: null, discarded: "internal_negative_notes" };
  }

  return { enhancement: structuredCloneSafe(value), discarded: "" };
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
      if (key === "final_prompt" || key === "compiled_prompt") found = true;
    }
  });
  return found;
}

function containsUnauthorizedReference(value, binding) {
  const allowed = new Set((binding?.resolved_references || []).map((item) => item.reference_id));
  let found = false;
  walk(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, raw] of Object.entries(node)) {
      if (!/^reference_ids?$/.test(key)) continue;
      const ids = Array.isArray(raw) ? raw : [raw];
      for (const id of ids) {
        if (typeof id === "string" && id && !allowed.has(id)) found = true;
      }
    }
  });
  return found;
}

function containsUnauthorizedUrl(value, binding) {
  const allowed = new Set((binding?.resolved_references || []).map((item) => item.url).filter(Boolean));
  const serialized = JSON.stringify(value);
  const urls = serialized.match(/https?:\/\/[^"\\\s]+/gi) || [];
  return urls.some((url) => !allowed.has(url));
}

function validStoryboardShape(value) {
  if ("shot_plan" in value && !Array.isArray(value.shot_plan)) return false;
  if ("normalized_shot_plan" in value && !Array.isArray(value.normalized_shot_plan)) return false;
  if (!value.storyboard_processing) return true;
  if (value.storyboard_processing === "normalize_shot_list") return Array.isArray(value.normalized_shot_plan);
  if (value.storyboard_processing === "script_to_storyboard") return !("normalized_shot_plan" in value);
  if (value.storyboard_processing === "preserve_full_prompt") return !("shot_plan" in value) && !("normalized_shot_plan" in value);
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
