import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { handleImageGeneration, resolveGeneratedImagePublicBaseUrl } from "./src/routes/image-generations.js";
import { handlePromptOptimization } from "./src/routes/prompt-optimizations.js";
import { ImageApiError, v36ImageGenerationErrorPayload } from "./src/core/errors.js";
import { generatedImageHttpResponse } from "./src/core/generated-image-response.js";
import { putGeneratedImage } from "./src/core/generated-image-store.js";
import { LEGACY_IMAGE_JOBS_DEPRECATION_HEADERS } from "./src/core/legacy-api.js";
import { loadAiTuRuntimeConfig } from "./src/providers/ai-tu-provider-adapter.js";
import { parseJsonWithoutDuplicateKeys } from "./src/core/runtime.js";
import { normalizePublicHttpUrl } from "./src/core/url-security.js";

const ROOT = resolve(import.meta.dirname);
const AI_TU_HTML_FILE = resolve(ROOT, "ai-tu/ai-image-generator.html");
const AI_TU_ROOT = resolve(ROOT, "ai-tu");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = parseBytes(process.env.MAX_BODY_SIZE || "2mb");

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
    const invalid = invalidJsonPayload(body);
    if (invalid) return sendJson(response, invalid.statusCode, v36InvalidJsonPayload(invalid.payload));
    const result = await handleImageGeneration(body);
    return sendJson(response, result.statusCode, result.payload);
  }
  if (request.method === "POST" && (url.pathname === "/api/prompt-optimizer" || url.pathname === "/api/v1/prompt-optimizations")) {
    const body = await readJson(request);
    const invalid = invalidJsonPayload(body);
    if (invalid) return sendJson(response, invalid.statusCode, invalid.payload);
    const result = await handlePromptOptimization(body);
    return sendJson(response, result.statusCode, result.payload);
  }
  if (request.method === "POST" && url.pathname === "/api/reference-images") {
    const result = await handleReferenceImageUpload(request);
    return sendJson(response, result.statusCode, result.payload);
  }
  if (request.method === "POST" && url.pathname === "/api/image-jobs") {
    const result = disabledLegacyImageJob();
    return sendJson(response, result.statusCode, result.payload, LEGACY_IMAGE_JOBS_DEPRECATION_HEADERS);
  }
  const legacyJobMatch = url.pathname.match(/^\/api\/image-jobs\/([^/]+)$/);
  if (request.method === "GET" && legacyJobMatch) {
    const result = disabledLegacyImageJob();
    return sendJson(response, result.statusCode, result.payload, LEGACY_IMAGE_JOBS_DEPRECATION_HEADERS);
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

async function handleReferenceImageUpload(request) {
  try {
    const contentType = String(request.headers["content-type"] || "");
    if (!/^multipart\/form-data\b/i.test(contentType)) {
      throw new ImageApiError({
        statusCode: 400,
        status: "failed",
        errorCode: "INVALID_REQUEST_SCHEMA",
        message: "参考图上传必须使用 multipart/form-data。"
      });
    }
    const form = await requestToFormData(request, contentType);
    const file = form.get("image");
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new ImageApiError({
        statusCode: 400,
        status: "failed",
        errorCode: "INVALID_REQUEST_SCHEMA",
        message: "缺少 image 文件字段。"
      });
    }
    const mime = String(file.type || "image/png").toLowerCase();
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mime)) {
      throw new ImageApiError({
        statusCode: 400,
        status: "failed",
        errorCode: "INVALID_REQUEST_SCHEMA",
        message: "参考图只支持 png、jpeg 或 webp。"
      });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = putGeneratedImage({
      bytes,
      mime: mime.replace("image/jpg", "image/jpeg"),
      source: "browser_reference_upload"
    });
    const name = safeUploadName(String(form.get("name") || file.name || "reference.png"));
    const imageHost = referenceImageHostConfig();
    if (imageHost.imageHostMode === "imgbb") {
      const uploaded = await uploadReferenceToImgbb({
        bytes,
        type: stored.mime,
        filename: name
      }, imageHost, stored.id);
      return {
        statusCode: 200,
        payload: {
          status: "succeeded",
          referenceId: `ref_upload_${stored.id.replace(/^img_/, "").slice(0, 18)}`,
          image_url: uploaded.image_url,
          url: uploaded.url,
          name,
          type: stored.mime,
          size: stored.size,
          host: uploaded.host
        }
      };
    }
    return {
      statusCode: 200,
      payload: {
        status: "succeeded",
        referenceId: `ref_upload_${stored.id.replace(/^img_/, "").slice(0, 18)}`,
        image_url: publicGeneratedImageUrl(stored.path),
        url: publicGeneratedImageUrl(stored.path),
        name,
        type: stored.mime,
        size: stored.size,
        host: "generated-image-store"
      }
    };
  } catch (error) {
    const statusCode = Number(error && error.statusCode) || 400;
    return {
      statusCode,
      payload: {
        status: "failed",
        error_code: error && error.errorCode ? error.errorCode : "INVALID_REQUEST_SCHEMA",
        message: error instanceof Error ? error.message : "参考图上传失败。"
      }
    };
  }
}

function referenceImageHostConfig() {
  const fileConfig = loadAiTuRuntimeConfig();
  const imageHostMode = stringValue(process.env.IMAGE_HOST_MODE || fileConfig.imageHostMode).trim().toLowerCase() === "imgbb"
    ? "imgbb"
    : "local";
  return {
    imageHostMode,
    imageHostUploadUrl: normalizeHttpEndpoint(process.env.IMGBB_UPLOAD_URL || fileConfig.imageHostUploadUrl || "https://api.imgbb.com/1/upload"),
    imageHostApiKey: stringValue(process.env.IMGBB_API_KEY || process.env.IMAGE_HOST_API_KEY || fileConfig.imageHostApiKey).trim(),
    imageHostExpirationSeconds: clampInt(process.env.IMGBB_EXPIRATION_SECONDS || fileConfig.imageHostExpirationSeconds, 0, 15_552_000, 0),
    requestTimeoutSeconds: clampInt(process.env.REQUEST_TIMEOUT_SECONDS || fileConfig.requestTimeoutSeconds, 10, 900, 180)
  };
}

async function uploadReferenceToImgbb(file, config, referenceId) {
  if (!config.imageHostApiKey) {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "IMAGE_HOST_CONFIG_MISSING",
      message: "图床 API Key 未配置。"
    });
  }
  const url = new URL(config.imageHostUploadUrl);
  url.searchParams.set("key", config.imageHostApiKey);
  if (config.imageHostExpirationSeconds >= 60) {
    url.searchParams.set("expiration", String(config.imageHostExpirationSeconds));
  }
  const form = new FormData();
  form.append("image", new Blob([file.bytes], { type: file.type || "image/png" }), safeUploadName(file.filename || "reference.png"));
  const name = safeUploadName(file.filename || "");
  if (name) form.append("name", name);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutSeconds * 1000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new ImageApiError({
        statusCode: 504,
        status: "failed",
        errorCode: "IMAGE_HOST_TIMEOUT",
        message: "图床上传超时，请稍后重试。"
      });
    }
    throw new ImageApiError({
      statusCode: 502,
      status: "failed",
      errorCode: "IMAGE_HOST_UNREACHABLE",
      message: "图床连接失败。"
    });
  } finally {
    clearTimeout(timeout);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload.success === false) {
    throw new ImageApiError({
      statusCode: 502,
      status: "failed",
      errorCode: "IMAGE_HOST_FAILED",
      message: imageHostErrorMessage(payload) || `图床上传失败，HTTP ${response.status}。`
    });
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const imageUrl = [
    data.url,
    data.display_url,
    data.image && data.image.url,
    data.medium && data.medium.url,
    data.thumb && data.thumb.url
  ].find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
  if (!imageUrl) {
    throw new ImageApiError({
      statusCode: 502,
      status: "failed",
      errorCode: "IMAGE_HOST_MISSING_URL",
      message: "图床上传成功但没有返回图片 URL。"
    });
  }
  return {
    referenceId,
    host: "imgbb",
    url: normalizePublicHttpUrl(imageUrl, "image_host.url", {
      allowLocal: false,
      statusCode: 502,
      errorCode: "IMAGE_HOST_UNSAFE_URL"
    }),
    image_url: normalizePublicHttpUrl(imageUrl, "image_host.url", {
      allowLocal: false,
      statusCode: 502,
      errorCode: "IMAGE_HOST_UNSAFE_URL"
    })
  };
}

async function requestToFormData(request, contentType) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new ImageApiError({
        statusCode: 400,
        status: "failed",
        errorCode: "INVALID_REQUEST_SCHEMA",
        message: "请求体过大。"
      });
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const webRequest = new Request("http://local.invalid/api/reference-images", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(body)
  });
  return webRequest.formData();
}

function publicGeneratedImageUrl(path) {
  const base = resolveGeneratedImagePublicBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function imageHostErrorMessage(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const candidates = [
    source.error && source.error.message,
    source.message,
    source.status_txt
  ];
  return candidates.find((item) => typeof item === "string" && item.trim()) || "";
}

function safeUploadName(name) {
  return String(name || "reference.png").replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 120) || "reference.png";
}

function stringValue(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeHttpEndpoint(value) {
  const text = stringValue(value).trim();
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
    if (parsed.username || parsed.password) throw new Error("bad auth");
    parsed.hash = "";
    return parsed.toString();
  } catch {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "IMAGE_HOST_CONFIG_INVALID",
      message: "图床上传地址必须是 http 或 https URL。"
    });
  }
}

function disabledLegacyImageJob() {
  return {
    statusCode: 410,
    payload: {
      status: "failed",
      error_code: "LEGACY_IMAGE_JOBS_DISABLED",
      message: "Deprecated /api/image-jobs 已禁用，请使用 /api/v1/image-generations。"
    }
  };
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
  if (!text) return {};
  const parsed = parseJsonWithoutDuplicateKeys(text);
  if (parsed.duplicate) {
    return {
      __invalid: true,
      error_code: "INVALID_REQUEST_SCHEMA",
      message: "请求体包含重复字段。"
    };
  }
  if (!parsed.ok) {
    return {
      __invalid: true,
      error_code: "INVALID_REQUEST_SCHEMA",
      message: "请求体不是合法 JSON。"
    };
  }
  return parsed.value;
}

function invalidJsonPayload(body) {
  if (!body || body.__invalid !== true) return null;
  return {
    statusCode: 400,
    payload: {
      request_id: "",
      status: "failed",
      error_code: "INVALID_REQUEST_SCHEMA",
      message: typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "请求体不是合法 JSON。"
    }
  };
}

function v36InvalidJsonPayload(payload) {
  return v36ImageGenerationErrorPayload(new ImageApiError({
    statusCode: 400,
    status: "failed",
    errorCode: payload.error_code || "INVALID_REQUEST_SCHEMA",
    message: payload.message || "请求体不是合法 JSON。"
  })).payload;
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
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
