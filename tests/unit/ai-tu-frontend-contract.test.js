import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(root, "ai-tu/ai-image-generator.html"), "utf8");
const server = readFileSync(resolve(root, "server.js"), "utf8");
const gateway = readFileSync(resolve(root, "ai-tu/gateway/server.js"), "utf8");

test("ai-tu original page contains prompt optimizer entry and six task_type options", () => {
  assert.match(html, /帧界图片生成器极速版/);
  assert.match(html, /提示词优化/);
  assert.match(html, /id="optimizePromptBtn"/);
  assert.match(html, /id="optimizerSixTaskSamplesBtn"/);
  for (const taskType of ["text_image", "image_reference", "character_multiview", "scene_multiview", "prop_multiview", "storyboard"]) {
    assert.match(html, new RegExp(`<option value="${taskType}"`));
  }
  for (const field of ["reference_id", "entity_name", "entity_type", "role", "url", "mime_type", "display_name", "description"]) {
    assert.match(html, new RegExp(field));
  }
});

test("root service serves ai-tu page instead of independent console", () => {
  assert.match(server, /ai-tu\/ai-image-generator\.html/);
  assert.doesNotMatch(server, /src\/web/);
  assert.doesNotMatch(server, /Image API Console/);
});

test("frontend calls prompt optimizer and overwrites original prompt only on success", () => {
  assert.match(html, /fetch\("\/api\/prompt-optimizer"/);
  assert.match(html, /result\.status !== "succeeded"/);
  assert.match(html, /controls\.prompt\.value = result\.optimized_prompt/);
  assert.match(html, /controls\.prompt\.value = originalPrompt/);
});

test("frontend image generation request uses V3.6 builders and structured references", () => {
  const textBuilder = extractFunctionBody(html, "buildTextImageRequest");
  const imageBuilder = extractFunctionBody(html, "buildImageReferenceRequest");
  assert.match(html, /function buildTextImageRequest\(\)/);
  assert.match(textBuilder, /task_type: "text_image"/);
  assert.match(textBuilder, /references: \[\]/);
  assert.doesNotMatch(textBuilder, /optimizerTaskType/);
  assertNoForbiddenFinalApiRequestFieldSource(textBuilder);
  assert.match(html, /function buildImageReferenceRequest\(\)/);
  assertNoForbiddenFinalApiRequestFieldSource(imageBuilder);
  assert.match(html, /\.\.\.manualReferences/);
  assert.match(html, /references: structuredReferences/);
  assert.match(html, /collectOptimizerReferences\(\{ requireUrl: true \}\)/);
  assert.match(html, /uploadedReferencesFromSlots\(refList, manualReferences\)/);
  assert.match(html, /reference_id: sanitizeReferenceId/);
  assert.match(html, /reference_policy:/);
  assert.match(html, /图生图模式请先上传参考图，且参考图必须已得到 http\(s\) URL。/);
  assert.match(html, /finalApiEndpoint = "\/api\/v1\/image-generations"/);
  assert.match(html, /fetch\(finalApiEndpoint/);
  assert.doesNotMatch(html, /fetch\("\/api\/image-jobs"/);
  assert.doesNotMatch(html, /fetch\(`\/api\/image-jobs/);
});

test("frontend does not persist temporary pending jobs into legacy restore polling", () => {
  assert.match(html, /function isRestorableJobId\(jobId\)/);
  assert.match(html, /startsWith\("pending_"\)/);
  assert.match(html, /isRestorableJobId\(job\.jobId\) && \(job\.status === "queued" \|\| job\.status === "running"\)/);
  assert.match(html, /localStorage\.removeItem\(PENDING_STORAGE_KEY\)/);
  assert.match(html, /旧图片任务接口已停用，请重新提交生成。/);
  assert.doesNotMatch(html, /if \(job\.status === "queued" \|\| job\.status === "running"\) addPendingJob\(job\.jobId\);/);
  assert.doesNotMatch(html, /fetch\(`\/api\/image-jobs/);
  assert.doesNotMatch(html, /fetch\("\/api\/image-jobs/);
});

test("frontend formats structured final image errors without object placeholders", () => {
  assert.match(html, /function jobErrorMessage\(job\)/);
  assert.match(html, /function normalizeErrorMessage\(error\)/);
  assert.match(html, /function formatBackendCallSummaryError\(summary\)/);
  assert.match(html, /backend_call_summary/);
  assert.match(html, /上游返回 502/);
  assert.match(html, /请求终止/);
  assert.doesNotMatch(html, /job\.error \|\| "未知错误"/);
});

test("frontend only renders and downloads public http image URLs", () => {
  assert.match(html, /function imageToSrc\(image\)/);
  assert.match(html, /function isPublicImageUrl\(value\)/);
  assert.match(html, /isPublicImageUrl\(image\.url\)/);
  assert.match(html, /isPublicImageUrl\(source\)/);
  assert.doesNotMatch(html, /image\.b64_json/);
  assert.doesNotMatch(html, /image\.base64/);
  assert.doesNotMatch(html, /dataUrlToObjectUrl/);
  assert.doesNotMatch(html, /\^data:/);
  assert.doesNotMatch(html, /atob\(payload/);
});

test("gateway proxies final image requests without legacy provider direct mapping", () => {
  assert.match(gateway, /handlePromptBackendImageGeneration/);
  assert.match(gateway, /normalizeFinalImageRequest/);
  assert.match(gateway, /postPromptImageBackend/);
  assert.doesNotMatch(gateway, /normalizeStructuredReferenceImage/);
  assert.doesNotMatch(gateway, /runMockUpstream/);
  assert.doesNotMatch(gateway, /postLiveImageUrlJson/);
  assert.doesNotMatch(gateway, /postLiveImageEditMultipart/);
});

test("new frontend does not expose forbidden internal labels", () => {
  const visibleHtml = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
  for (const token of ["final_prompt", "compiled_prompt", "enhancement", "RAGFlow 原始输出", "fallback", "provider internal payload"]) {
    assert.equal(visibleHtml.includes(token), false, `visible forbidden token: ${token}`);
  }
});

function assertNoForbiddenFinalApiRequestFieldSource(source) {
  for (const field of ["model", "mode", "size", "output_format"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${field}\\s*:`), `frontend request builder still sets ${field}`);
  }
  for (const field of ["resolution", "format"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${field}\\s*:`), `frontend request builder still sets top-level ${field}`);
  }
  assert.doesNotMatch(source, /return_format:\s*"png"/, "frontend request builder still sets top-level return_format=png");
}

function extractFunctionBody(source, name) {
  const signature = `function ${name}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `${name} body not found`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`${name} body not closed`);
}
