import { ImageApiError, v36ImageGenerationErrorPayload } from "../core/errors.js";
import { extractEntityMentions } from "../core/entity-mentions.js";
import { resolveReferences } from "../core/reference-binding.js";
import { compilePrompt } from "../core/prompt-compiler.js";
import { getRagflowEnhancement } from "../core/ragflow-enhancement.js";
import { assertNoForbiddenPublicFields, makeId, normalizeRequest } from "../core/runtime.js";
import { taskTypeLabel } from "../core/labels.js";
import { generateWithAiTuProvider } from "../providers/ai-tu-provider-adapter.js";
import { appendTrace } from "../storage/trace-store.js";
import { normalizePublicBaseUrl, normalizePublicHttpUrl } from "../core/url-security.js";

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
    const publicImages = providerResult.images.map((image) => ({
      url: publicImageUrl(image.url)
    }));

    const payload = {
      status: "succeeded",
      images: publicImages,
      warnings: binding.warnings
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
    const { statusCode, payload } = v36ImageGenerationErrorPayload(mapped);
    await appendTrace({
      endpoint: "/api/v1/image-generations",
      method: "POST",
      trace_id: traceId,
      request_id: requestId,
      task_type: taskType,
      generation_mode: generationMode,
      prompt,
      status: payload.status,
      error_code: payload.error.code,
      reference_count: referenceCount,
      callback_present: Boolean(body && (body.callback_url || body.callback)),
      image_count: 0,
      warning_count: 0,
      backend_call_summary: payload.error.backend_call_summary || null
    });
    return { statusCode, payload };
  }
}

export function publicImageUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) {
    return normalizePublicHttpUrl(url, "provider image url", {
      allowLocal: false,
      statusCode: 502,
      errorCode: "PROVIDER_IMAGE_URL_UNSAFE"
    });
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || !/^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/i.test(url)) {
    throw new ImageApiError({
      statusCode: 502,
      status: "failed",
      errorCode: "PROVIDER_IMAGE_URL_UNSAFE",
      message: "provider image url 必须是安全公网 HTTP(S) URL 或服务生成图片 URL。"
    });
  }
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
