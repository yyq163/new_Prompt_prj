import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname, normalize, resolve } from "node:path";
import { handleImageGeneration } from "./src/routes/image-generations.js";
import { handlePromptOptimization } from "./src/routes/prompt-optimizations.js";
import { ImageApiError } from "./src/core/errors.js";
import { makeId, stringValue } from "./src/core/runtime.js";
import { generateWithAiTuProvider } from "./src/providers/ai-tu-provider-adapter.js";
import { generatedImageHttpResponse } from "./src/core/generated-image-response.js";

const ROOT = resolve(import.meta.dirname);
const AI_TU_HTML_FILE = resolve(ROOT, "ai-tu/ai-image-generator.html");
const AI_TU_ROOT = resolve(ROOT, "ai-tu");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = parseBytes(process.env.MAX_BODY_SIZE || "2mb");
const legacyJobs = new Map();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      status: "failed",
      error_code: "INTERNAL_ERROR",
      message: "服务内部错误。"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[image-api] listening on http://${HOST}:${PORT}`);
});

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { ok: true, service: "final-image-generation-api" });
  }
  if (request.method === "POST" && url.pathname === "/api/v1/image-generations") {
    const body = await readJson(request);
    const result = await handleImageGeneration(body);
    return sendJson(response, result.statusCode, result.payload);
  }
  if (request.method === "POST" && (url.pathname === "/api/prompt-optimizer" || url.pathname === "/api/v1/prompt-optimizations")) {
    const body = await readJson(request);
    const result = await handlePromptOptimization(body);
    return sendJson(response, result.statusCode, result.payload);
  }
  if (request.method === "POST" && url.pathname === "/api/image-jobs") {
    const body = await readJson(request);
    const result = await createLegacyImageJob(body);
    return sendJson(response, result.statusCode, result.payload);
  }
  const legacyJobMatch = url.pathname.match(/^\/api\/image-jobs\/([^/]+)$/);
  if (request.method === "GET" && legacyJobMatch) {
    const job = legacyJobs.get(legacyJobMatch[1]);
    if (!job) return sendJson(response, 404, { status: "failed", error: "任务不存在或已过期。" });
    return sendJson(response, 200, publicLegacyJob(job));
  }
  const generatedImageMatch = url.pathname.match(/^\/api\/v1\/generated-images\/([^/]+)$/);
  if (request.method === "GET" && generatedImageMatch) {
    const result = generatedImageHttpResponse(decodeURIComponent(generatedImageMatch[1]));
    response.writeHead(result.statusCode, result.headers);
    return response.end(result.body);
  }
  if (request.method === "GET") {
    return serveStatic(url.pathname, response);
  }
  sendJson(response, 404, { status: "failed", error_code: "NOT_FOUND", message: "Not found." });
}

async function serveStatic(pathname, response) {
  if (pathname !== "/" && pathname !== "/ai-image-generator.html") {
    return sendJson(response, 404, { status: "failed", error_code: "NOT_FOUND", message: "Not found." });
  }
  const relative = pathname === "/" ? "ai-image-generator.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(AI_TU_ROOT, normalize(relative));
  if (!filePath.startsWith(AI_TU_ROOT)) {
    return sendJson(response, 403, { status: "failed", error_code: "FORBIDDEN", message: "Forbidden." });
  }
  try {
    const bytes = await readFile(pathname === "/" ? AI_TU_HTML_FILE : filePath);
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store"
    });
    response.end(bytes);
  } catch {
    return sendJson(response, 404, { status: "failed", error_code: "NOT_FOUND", message: "Not found." });
  }
}

async function createLegacyImageJob(body) {
  try {
    if (body && body.__invalid) {
      throw new ImageApiError({
        statusCode: 400,
        status: "failed",
        errorCode: body.error_code || "INVALID_REQUEST_SCHEMA",
        message: body.message || "请求体不是合法 JSON。"
      });
    }
    const request = normalizeLegacyImageJobRequest(body);
    const job = {
      jobId: makeId("job"),
      prompt: request.prompt,
      request,
      fill: buildLegacyFill(request),
      status: "queued",
      images: [],
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    legacyJobs.set(job.jobId, job);
    void runLegacyImageJob(job);
    return { statusCode: 202, payload: publicLegacyJob(job) };
  } catch (error) {
    const statusCode = Number(error && error.statusCode) || 400;
    return {
      statusCode,
      payload: {
        status: "failed",
        error: error instanceof Error ? error.message : "请求无效。"
      }
    };
  }
}

function normalizeLegacyImageJobRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ImageApiError({ statusCode: 400, message: "请求体必须是 JSON 对象。" });
  }
  const prompt = stringValue(body.prompt).trim();
  if (!prompt) throw new ImageApiError({ statusCode: 400, message: "请填写提示词。" });

  const references = normalizeLegacyReferences(body);
  const mode = body.mode === "image" || references.length ? "image" : "text";
  return {
    prompt,
    mode,
    model: stringValue(body.model).trim() || "gpt-image-2",
    size: stringValue(body.size).trim() || "auto",
    quality: stringValue(body.quality).trim() || "auto",
    output_format: stringValue(body.output_format || body.format).trim() || "png",
    n: clamp(Number(body.n || 1), 1, 10),
    references
  };
}

function normalizeLegacyReferences(body) {
  const images = Array.isArray(body.images) ? body.images : [];
  const structuredRefs = Array.isArray(body.references) ? body.references : [];
  const refs = [];
  images.forEach((image, index) => {
    const url = stringValue(image && (image.image_url || image.url)).trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) throw new ImageApiError({ statusCode: 400, message: "参考图只支持 http 或 https URL。" });
    refs.push({
      reference_id: stringValue(image.referenceId || image.reference_id || `legacy_image_${index + 1}`).trim(),
      entity_name: stringValue(image.entity_name || image.name || `参考图${index + 1}`).trim(),
      entity_type: stringValue(image.entity_type || "image").trim(),
      role: stringValue(image.role || "style_reference").trim(),
      url,
      mime_type: stringValue(image.mime_type || image.type || "image/*").trim(),
      display_name: stringValue(image.display_name || image.name || basename(new URL(url).pathname) || `reference-${index + 1}`).trim(),
      description: stringValue(image.description).trim(),
      order: refs.length + 1
    });
  });
  structuredRefs.forEach((ref, index) => {
    const url = stringValue(ref && ref.url).trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) throw new ImageApiError({ statusCode: 400, message: "references[].url 只支持 http 或 https URL。" });
    refs.push({
      reference_id: stringValue(ref.reference_id || `ref_${index + 1}`).trim(),
      entity_name: stringValue(ref.entity_name || ref.display_name || `参考对象${index + 1}`).trim(),
      entity_type: stringValue(ref.entity_type || "image").trim(),
      role: stringValue(ref.role || "style_reference").trim(),
      url,
      mime_type: stringValue(ref.mime_type || "image/*").trim(),
      display_name: stringValue(ref.display_name || basename(new URL(url).pathname) || `reference-${index + 1}`).trim(),
      description: stringValue(ref.description).trim(),
      order: refs.length + 1
    });
  });
  return refs;
}

async function runLegacyImageJob(job) {
  job.status = "running";
  job.updatedAt = Date.now();
  try {
    const providerRequest = {
      request_id: makeId("req"),
      task_type: job.request.references.length ? "image_reference" : "text_image",
      prompt: job.request.prompt,
      references: job.request.references,
      output: {
        count: job.request.n,
        aspect_ratio: sizeToAspect(job.request.size),
        quality: job.request.quality === "auto" ? "high" : job.request.quality,
        return_format: "url"
      },
      generation_mode: job.request.references.length ? "image_to_image" : "text_to_image"
    };
    const result = await generateWithAiTuProvider({
      request: providerRequest,
      compiledPrompt: job.request.prompt
    });
    job.images = result.images.map((image) => ({ url: image.url, image_url: image.url }));
    job.status = "succeeded";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "图片生成失败。";
  } finally {
    job.updatedAt = Date.now();
  }
}

function buildLegacyFill(request) {
  return {
    prompt: request.prompt,
    mode: request.mode,
    size: request.size,
    quality: request.quality,
    output_format: request.output_format,
    n: request.n,
    images: request.references.map((ref) => ({
      referenceId: ref.reference_id,
      name: ref.display_name,
      type: ref.mime_type,
      image_url: ref.url
    })),
    references: request.references
  };
}

function publicLegacyJob(job) {
  return {
    jobId: job.jobId,
    prompt: job.prompt,
    status: job.status,
    images: job.images,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    fill: job.fill
  };
}

function sizeToAspect(size) {
  const text = stringValue(size).trim();
  const match = text.match(/^(\d+)x(\d+)$/);
  if (!match) return "16:9";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "16:9";
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.05) return "1:1";
  if (ratio > 1.5) return "16:9";
  if (ratio < 0.75) return "9:16";
  if (ratio > 1) return "4:3";
  return "3:4";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      return {
        __invalid: true,
        error_code: "INVALID_REQUEST_SCHEMA",
        message: "请求体过大。"
      };
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      __invalid: true,
      error_code: "INVALID_REQUEST_SCHEMA",
      message: "请求体不是合法 JSON。"
    };
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function contentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function parseBytes(value) {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/^(\d+)(kb|mb|b)?$/);
  if (!match) return 2 * 1024 * 1024;
  const count = Number(match[1]);
  const unit = match[2] || "b";
  if (unit === "mb") return count * 1024 * 1024;
  if (unit === "kb") return count * 1024;
  return count;
}
