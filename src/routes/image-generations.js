import { ImageApiError, publicErrorPayload } from "../core/errors.js";
import { extractEntityMentions } from "../core/entity-mentions.js";
import { resolveReferences } from "../core/reference-binding.js";
import { compilePrompt } from "../core/prompt-compiler.js";
import { getRagflowEnhancement } from "../core/ragflow-enhancement.js";
import { assertNoForbiddenPublicFields, makeId, normalizeRequest } from "../core/runtime.js";
import { taskTypeLabel } from "../core/labels.js";
import { generateWithAiTuProvider } from "../providers/ai-tu-provider-adapter.js";
import { appendTrace } from "../storage/trace-store.js";
import { normalizePublicBaseUrl } from "../core/url-security.js";

export async function handleImageGeneration(body, { provider = generateWithAiTuProvider, fetchImpl = globalThis.fetch } = {}) {
  let requestId = "";
  const traceId = makeId("trace");
  let taskType = "";
  let generationMode = "";
  let prompt = "";
  let referenceCount = 0;
  try {
    const request = normalizeRequest(body);
    requestId = request.request_id;
    taskType = request.task_type;
    generationMode = request.generation_mode;
    prompt = request.prompt;
    referenceCount = request.references.length;
    const generationId = makeId("gen");

    const mentions = extractEntityMentions(request.prompt);
    const binding = resolveReferences(request, mentions);
    const enhancementResult = await getRagflowEnhancement({ request, binding, fetchImpl });
    const compiled = compilePrompt({ request, binding, enhancement: enhancementResult.enhancement });
    const providerResult = await provider({
      request,
      compiledPrompt: compiled.compiled_prompt,
      fetchImpl
    });
    const publicImages = providerResult.images.map((image, index) => ({
      image_id: image.image_id || `img_${String(index + 1).padStart(3, "0")}`,
      url: publicImageUrl(image.url),
      width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
      height: Number.isFinite(Number(image.height)) ? Number(image.height) : null,
      format: typeof image.format === "string" && image.format.trim() ? image.format.trim() : "png"
    }));

    const payload = {
      request_id: request.request_id,
      generation_id: generationId,
      status: "succeeded",
      task_type: request.task_type,
      task_type_label: taskTypeLabel(request.task_type),
      generation_mode: request.generation_mode,
      input: {
        prompt: request.prompt,
        task_type: request.task_type,
        task_type_label: taskTypeLabel(request.task_type)
      },
      images: publicImages,
      normalized: {
        entity_mentions: binding.entity_mentions,
        references_used: binding.references_used
      },
      warnings: binding.warnings,
      trace_id: traceId
    };
    assertNoForbiddenPublicFields(payload);
    await appendTrace({
      endpoint: "/api/v1/image-generations",
      method: "POST",
      trace_id: traceId,
      request_id: request.request_id,
      generation_id: generationId,
      task_type: request.task_type,
      generation_mode: request.generation_mode,
      prompt: request.prompt,
      reference_count: request.references.length,
      callback_present: Boolean(request.callback_url),
      image_count: publicImages.length,
      warning_count: binding.warnings.length,
      status: "succeeded"
    });
    return { statusCode: 200, payload };
  } catch (error) {
    const mapped = error instanceof ImageApiError ? error : error;
    const { statusCode, payload } = publicErrorPayload(mapped, requestId);
    await appendTrace({
      endpoint: "/api/v1/image-generations",
      method: "POST",
      trace_id: traceId,
      request_id: requestId,
      task_type: taskType,
      generation_mode: generationMode,
      prompt,
      status: payload.status,
      error_code: payload.error_code,
      reference_count: referenceCount,
      callback_present: Boolean(body && (body.callback_url || body.callback)),
      image_count: 0,
      warning_count: 0
    });
    payload.trace_id = payload.trace_id || traceId;
    assertNoForbiddenPublicFields(payload);
    return { statusCode, payload };
  }
}

function publicImageUrl(url) {
  if (!url || /^https?:\/\//i.test(url)) return url;
  const base = resolveGeneratedImagePublicBaseUrl();
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

export function resolveGeneratedImagePublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.trim()) {
    return normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL);
  }
  if (process.env.NODE_ENV === "production") {
    throw new ImageApiError({
      statusCode: 500,
      status: "failed",
      errorCode: "PUBLIC_BASE_URL_REQUIRED",
      message: "生产环境必须配置 PUBLIC_BASE_URL 才能返回 Generated Image Store 公网图片 URL。"
    });
  }
  const configuredHost = process.env.HOST || "127.0.0.1";
  const host = configuredHost === "0.0.0.0" || configuredHost === "::" ? "127.0.0.1" : configuredHost;
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${process.env.PORT || 8787}`;
}
