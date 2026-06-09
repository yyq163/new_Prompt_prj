import { ImageApiError, publicErrorPayload } from "../core/errors.js";
import { extractEntityMentions } from "../core/entity-mentions.js";
import { resolveReferences } from "../core/reference-binding.js";
import { compilePrompt } from "../core/prompt-compiler.js";
import { getRagflowEnhancement } from "../core/ragflow-enhancement.js";
import { assertNoForbiddenPublicFields, makeId, normalizeRequest } from "../core/runtime.js";
import { taskTypeLabel } from "../core/labels.js";
import { generateWithAiTuProvider } from "../providers/ai-tu-provider-adapter.js";
import { appendTrace } from "../storage/trace-store.js";

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
      images: providerResult.images,
      normalized: {
        entity_mentions: binding.entity_mentions,
        references_used: binding.references_used
      },
      warnings: binding.warnings,
      trace_id: traceId
    };
    assertNoForbiddenPublicFields(payload);
    await appendTrace({
      trace_id: traceId,
      request_id: request.request_id,
      generation_id: generationId,
      task_type: request.task_type,
      generation_mode: request.generation_mode,
      prompt: request.prompt,
      reference_count: request.references.length,
      image_count: providerResult.images.length,
      warning_count: binding.warnings.length,
      status: "succeeded"
    });
    return { statusCode: 200, payload };
  } catch (error) {
    const mapped = error instanceof ImageApiError ? error : error;
    const { statusCode, payload } = publicErrorPayload(mapped, requestId);
    await appendTrace({
      trace_id: traceId,
      request_id: requestId,
      task_type: taskType,
      generation_mode: generationMode,
      prompt,
      status: payload.status,
      error_code: payload.error_code,
      reference_count: referenceCount,
      image_count: 0,
      warning_count: 0
    });
    payload.trace_id = payload.trace_id || traceId;
    assertNoForbiddenPublicFields(payload);
    return { statusCode, payload };
  }
}
