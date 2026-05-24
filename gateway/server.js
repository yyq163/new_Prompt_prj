import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const ROOT = resolve(join(import.meta.dirname, ".."));
const HTML_FILE = resolve(ROOT, process.env.IMAGE_HTML_FILE || "ai-image-generator.html");
const CONFIG_FILE = resolve(ROOT, process.env.RUNTIME_CONFIG_FILE || "runtime-config.json");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const OWNER_COOKIE = "ai_image_owner";
const POLL_INTERVAL_SECONDS = 2;
const MAX_BODY_BYTES = parseBytes(process.env.MAX_BODY_SIZE || "50mb");
const REFERENCE_TTL_MS = clampInt(process.env.REFERENCE_TTL_MINUTES, 1, 240, 30) * 60 * 1000;
const JOB_TTL_MS = clampInt(process.env.JOB_TTL_MINUTES, 1, 240, 30) * 60 * 1000;
const UPSTREAM_RETRY_BASE_DELAY_MS = 2000;
const UPSTREAM_RETRY_MAX_DELAY_MS = 30_000;

const jobs = new Map();
const queue = [];
const referenceImages = new Map();
let runningCount = 0;
let upstreamKeyCursor = 0;
let runtimeConfig = await loadRuntimeConfig();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (error && typeof error.status === "number") {
      return sendJson(response, error.status, {
        error: {
          code: error.code || "request_failed",
          message: error.message || "请求失败。"
        }
      });
    }
    console.error("[gateway] internal error", {
      message: error && error.message ? error.message : String(error)
    });
    sendJson(response, 500, {
      error: {
        code: "internal_error",
        message: "网关内部错误。"
      }
    });
  }
});

server.listen(PORT, HOST, () => {
  const config = getRuntimeConfig();
  console.log(`[gateway] listening on http://${HOST}:${PORT} mode=${config.upstreamMode} maxConcurrency=${formatMaxConcurrency(config.maxConcurrency)} upstreamKeys=${activeKeys(config).length}`);
  console.log(`[gateway] runtime config ${CONFIG_FILE}`);
});

setInterval(cleanExpiredRecords, 60_000).unref();

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    return serveHtml(response);
  }

  if (request.method === "GET" && (url.pathname === "/config" || url.pathname === "/peizhi")) {
    return serveConfigPage(request, response);
  }

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204, {
      "Cache-Control": "public, max-age=86400"
    });
    return response.end();
  }

  if (request.method === "GET" && url.pathname === "/api/runtime") {
    const { ownerToken, isNewOwner } = ensureOwner(request);
    if (isNewOwner) setOwnerCookie(response, ownerToken);
    const config = getRuntimeConfig();
    return sendJson(response, 200, {
      service: request.headers.host || `${HOST}:${PORT}`,
      mode: config.upstreamMode,
      model: config.model,
      upstreamBase: config.baseUrl,
      imageHostMode: config.imageHostMode,
      upstreamKeyCount: activeKeys(config).length,
      pollIntervalSeconds: POLL_INTERVAL_SECONDS
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return sendJson(response, 200, configResponse(request));
  }

  if (request.method === "POST" && url.pathname === "/api/config") {
    const body = await readJson(request);
    runtimeConfig = sanitizeRuntimeConfig(body);
    await saveRuntimeConfig(runtimeConfig);
    upstreamKeyCursor = 0;
    return sendJson(response, 200, {
      ok: true,
      message: "已保存并生效。",
      config: configResponse(request).config
    });
  }

  if (request.method === "POST" && url.pathname === "/api/reload-config") {
    runtimeConfig = await loadRuntimeConfig();
    upstreamKeyCursor = 0;
    return sendJson(response, 200, {
      ok: true,
      message: "已重新加载。",
      config: configResponse(request).config
    });
  }

  if (request.method === "POST" && url.pathname === "/api/image-jobs") {
    const { ownerToken, isNewOwner } = ensureOwner(request);
    if (isNewOwner) setOwnerCookie(response, ownerToken);
    const body = await readJson(request);
    const job = createJob(ownerToken, body);
    enqueue(job);
    return sendJson(response, 202, publicJob(job));
  }

  const jobMatch = url.pathname.match(/^\/api\/image-jobs\/([^/]+)$/);
  if (request.method === "GET" && jobMatch) {
    const { ownerToken, isNewOwner } = ensureOwner(request);
    if (isNewOwner) setOwnerCookie(response, ownerToken);
    const jobId = decodeURIComponent(jobMatch[1]);
    const job = jobs.get(jobId);
    if (!job) {
      return sendJson(response, 404, {
        error: {
          code: "job_not_found",
          message: "任务不存在或已过期。"
        }
      });
    }
    if (job.ownerToken !== ownerToken) {
      return sendJson(response, 403, {
        error: {
          code: "forbidden",
          message: "无权查看该任务。"
        }
      });
    }
    response.setHeader("Cache-Control", "no-store");
    return sendJson(response, 200, publicJob(job));
  }

  if (request.method === "POST" && url.pathname === "/api/reference-images") {
    const { ownerToken, isNewOwner } = ensureOwner(request);
    if (isNewOwner) setOwnerCookie(response, ownerToken);
    return sendJson(response, 200, await uploadReferenceFromRequest(request, ownerToken, request.headers.host || `${HOST}:${PORT}`));
  }

  const referenceMatch = url.pathname.match(/^\/api\/reference-images\/([^/]+)$/);
  if (request.method === "GET" && referenceMatch) {
    return serveReferenceImage(response, decodeURIComponent(referenceMatch[1]));
  }

  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "未找到资源。"
    }
  });
}

async function serveHtml(response) {
  const html = await readFile(HTML_FILE, "utf8");
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

function createJob(ownerToken, body) {
  const request = normalizeImageRequest(body, ownerToken);
  const job = {
    jobId: makeJobId(),
    ownerToken,
    prompt: request.prompt,
    request,
    status: "queued",
    images: [],
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  jobs.set(job.jobId, job);
  console.log("[gateway] job queued", {
    jobId: job.jobId,
    mode: request.mode,
    imageCount: request.images.length
  });
  return job;
}

function normalizeImageRequest(body, ownerToken = "") {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "invalid_json", "请求体不是合法 JSON 对象。");
  }

  const config = getRuntimeConfig();
  const prompt = stringValue(body.prompt).trim();
  if (!prompt) {
    throw httpError(400, "invalid_prompt", "请填写提示词。");
  }

  const n = clampInt(body.n, 1, 4, 1);
  const quality = enumValue(body.quality, ["auto", "low", "medium", "high"], "auto");
  const outputFormat = enumValue(body.output_format || body.format, ["png", "jpeg", "webp"], "png");
  const size = normalizeSize(body.size);
  const rawImages = Array.isArray(body.images) ? body.images : [];
  const images = rawImages.map(normalizeReferenceImage).filter(Boolean);
  if (rawImages.length && images.length !== rawImages.length) {
    throw httpError(400, "invalid_reference_image", "参考图必须先上传到图床，并使用 image_url。");
  }
  const mode = body.mode === "image" || images.length ? "image" : "text";

  return {
    prompt,
    model: config.model || stringValue(body.model).trim() || "gpt-image-2",
    ownerToken,
    size,
    quality,
    output_format: outputFormat,
    n,
    mode,
    images
  };
}

function normalizeReferenceImage(item, index) {
  if (!item || typeof item !== "object") return null;
  const remoteUrl = stringValue(item.image_url || item.url).trim();
  if (/^https?:\/\//i.test(remoteUrl)) {
    return {
      referenceId: stringValue(item.referenceId).trim(),
      name: safeFilename(item.name || `reference-${index + 1}`),
      type: stringValue(item.type || "image/*").toLowerCase(),
      url: remoteUrl,
      image_url: remoteUrl
    };
  }
  return null;
}

function normalizeSize(value) {
  const size = stringValue(value).trim();
  if (!size || size === "auto") return "auto";
  if (/^\d{2,5}x\d{2,5}$/.test(size)) return size;
  return "auto";
}

function enqueue(job) {
  queue.push(job.jobId);
  schedule();
}

function schedule() {
  const maxConcurrency = getRuntimeConfig().maxConcurrency;
  while (runningCount < maxConcurrency && queue.length) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job || job.status !== "queued") continue;
    runningCount += 1;
    runJob(job).finally(() => {
      runningCount -= 1;
      schedule();
    });
  }
}

async function runJob(job) {
  job.status = "running";
  job.updatedAt = Date.now();
  console.log("[gateway] job running", { jobId: job.jobId });

  try {
    const images = getRuntimeConfig().upstreamMode === "live"
      ? await runLiveUpstream(job.request)
      : await runMockUpstream(job.request, job.jobId);
    job.images = images;
    job.status = "succeeded";
    job.error = null;
    job.updatedAt = Date.now();
    console.log("[gateway] job succeeded", {
      jobId: job.jobId,
      images: images.length
    });
  } catch (error) {
    job.images = [];
    job.status = "failed";
    job.error = errorToMessage(error);
    job.updatedAt = Date.now();
    console.error("[gateway] job failed", {
      jobId: job.jobId,
      message: job.error
    });
  }
}

async function runMockUpstream(request, jobId) {
  await sleep(700 + Math.floor(Math.random() * 600));
  if (/fail/i.test(request.prompt)) {
    throw new Error("mock 失败：提示词触发失败路径。");
  }

  const count = Math.max(1, request.n);
  return Array.from({ length: count }, (_, index) => {
    const svg = mockSvg(request.prompt, jobId, index + 1, request.mode);
    return {
      mime: "image/svg+xml",
      b64_json: Buffer.from(svg, "utf8").toString("base64"),
      url: "",
      revised_prompt: request.prompt
    };
  });
}

async function runLiveUpstream(request) {
  const config = getRuntimeConfig();
  if (!activeKeys(config).length) {
    throw new Error("服务端未配置图片生成密钥。");
  }

  if (request.mode === "image" && request.images.length) {
    return config.imageTransport === "edit"
      ? postLiveImageEditMultipart(request, config)
      : postLiveImageUrlJson(request, config);
  }

  return postLiveJson(config.baseUrl, baseUpstreamPayload(request));
}

function baseUpstreamPayload(request) {
  const payload = {
    model: request.model,
    prompt: request.prompt,
    n: request.n,
    size: request.size,
    format: request.output_format
  };
  if (payload.size === "auto") delete payload.size;
  if (request.quality && request.quality !== "auto") payload.quality = request.quality;
  return payload;
}

async function postLiveJson(kind, payload) {
  const body = JSON.stringify(payload);
  const json = await fetchUpstream(kind, (credential) => ({
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.key}`,
      "Content-Type": "application/json"
    },
    body
  }));
  return extractImages(json, payload.format);
}

async function postLiveImageUrlJson(request, config = getRuntimeConfig()) {
  const referenceUrls = request.images
    .map((image) => image.image_url || image.url)
    .filter(Boolean);
  if (!referenceUrls.length) {
    throw httpError(400, "missing_reference_image_url", "图生图需要至少一张参考图 URL。");
  }
  const count = Math.max(1, Math.min(request.n || 1, 16));
  const slots = Array.from({ length: count });
  const batches = await mapWithConcurrency(slots, Math.min(2, count), () => (
    postSingleLiveImageUrlJson(request, referenceUrls, config, 1)
  ));
  const images = batches.flat();
  return images.slice(0, count);
}

async function postSingleLiveImageUrlJson(request, referenceUrls, config, count) {
  const payload = {
    ...baseUpstreamPayload({
      ...request,
      n: Math.max(1, Math.min(count || 1, 16)),
      model: config.imageModel || "gpt-image-2-all"
    }),
    image: referenceUrls
  };
  const body = JSON.stringify(payload);
  const json = await fetchUpstream(config.baseUrl, (credential) => ({
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.key}`,
      "Content-Type": "application/json"
    },
    body
  }));
  return extractImages(json, request.output_format);
}

async function postLiveImageEditMultipart(request, config = getRuntimeConfig()) {
  const count = Math.max(1, Math.min(request.n || 1, 16));
  const images = [];
  for (let index = 0; index < count; index += 1) {
    images.push(...await postSingleLiveImageEditMultipart(request, config));
  }
  return images.slice(0, count);
}

async function postSingleLiveImageEditMultipart(request, config = getRuntimeConfig()) {
  const form = new FormData();
  form.append("model", config.imageModel || "gpt-image-2");
  form.append("prompt", request.prompt);
  form.append("n", "1");
  if (request.size && request.size !== "auto") form.append("size", request.size);

  for (const image of request.images) {
    const stored = storedReferenceForRequest(image, request.ownerToken);
    if (!stored) {
      throw httpError(400, "missing_reference_file", "编辑接口需要重新上传参考图，历史记录里的图床 URL 不能直接转成文件。");
    }
    const blob = new Blob([stored.bytes], { type: stored.type || image.type || "image/png" });
    form.append("image", blob, stored.name || image.name || "reference.png");
  }

  const json = await fetchUpstream(config.imageEditUrl, (credential) => ({
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.key}`
    },
    body: form
  }));
  return extractImages(json, request.output_format);
}

async function fetchUpstream(kind, initFactory) {
  const config = getRuntimeConfig();
  let lastError = null;
  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    const credential = nextImageApiCredential();
    try {
      const init = typeof initFactory === "function" ? initFactory(credential) : initFactory;
      if (!credential) {
        throw new Error("服务端未配置图片生成密钥。");
      }
      return await fetchUpstreamOnce(kind, init);
    } catch (error) {
      lastError = error;
      if (!isRetryableUpstreamError(error) || attempt === config.retryAttempts) break;
      const delayMs = retryDelayMs(error, attempt);
      console.warn("[gateway] upstream retry", {
        kind,
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        keyIndex: credential ? credential.index : 0,
        keyCount: credential ? credential.total : 0,
        status: error.status || 0,
        message: error.message
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function fetchUpstreamOnce(kind, init) {
  const config = getRuntimeConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutSeconds * 1000);
  try {
    const response = await fetch(resolveUpstreamUrl(kind), {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { rawText: text.slice(0, 1000) };
    }
    if (!response.ok) {
      const detail = upstreamErrorDetail(json, text, response.statusText);
      throw httpError(response.status, "upstream_failed", `请求失败 ${response.status}：${detail}`, {
        upstreamStatus: response.status,
        upstreamEndpoint: kind,
        upstreamError: detail,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"))
      });
    }
    return json;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw httpError(504, "upstream_timeout", "上游图片生成请求超时。");
    }
    if (error && String(error.message || "").toLowerCase() === "terminated") {
      throw httpError(502, "upstream_terminated", "上游图片生成连接提前中断。");
    }
    if (error && String(error.message || "").toLowerCase() === "fetch failed") {
      throw httpError(502, "upstream_unreachable", "上游图片生成连接失败。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableUpstreamError(error) {
  if (!error || typeof error.status !== "number") return false;
  return error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
}

function retryDelayMs(error, attempt) {
  const retryAfterMs = Number(error && error.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(UPSTREAM_RETRY_MAX_DELAY_MS, Math.max(1000, retryAfterMs));
  }
  return Math.min(UPSTREAM_RETRY_MAX_DELAY_MS, UPSTREAM_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit || 1, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseRetryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds * 1000));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, timestamp - Date.now());
}

function resolveUpstreamUrl(kind) {
  if (/^https?:\/\//i.test(kind)) return kind;
  return getRuntimeConfig().baseUrl;
}

function extractImages(json, format = "png") {
  const found = [];
  const seen = new Set();

  if (Array.isArray(json && json.data)) {
    json.data.forEach((item) => pushImage(item));
  }

  if (Array.isArray(json && json.output)) {
    json.output.forEach((item) => {
      if (item && item.type === "image_generation_call" && item.result) {
        pushImage({ b64_json: item.result, revised_prompt: item.revised_prompt });
      }
      if (Array.isArray(item && item.content)) {
        item.content.forEach((part) => pushImage(part));
      }
    });
  }

  walk(json, (node) => {
    if (!node || typeof node !== "object") return;
    if (node.b64_json || node.base64 || node.image_base64 || node.image || node.url || node.image_url || (node.type === "image_generation_call" && node.result)) {
      pushImage(node.type === "image_generation_call" ? { b64_json: node.result, revised_prompt: node.revised_prompt } : node);
    }
  });

  if (!found.length) {
    throw new Error("接口返回里没有找到可预览的图片字段。");
  }

  return found;

  function pushImage(item) {
    if (!item || typeof item !== "object") return;
    const imageValue = item.image && typeof item.image === "string" ? item.image : "";
    const base64 = cleanBase64(item.b64_json || item.base64 || item.image_base64 || item.result || imageValue || "");
    const url = [item.url, item.image_url, item.output_url].find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
    const key = base64 || url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push({
      mime: imageMime(item, format),
      b64_json: base64,
      url,
      revised_prompt: stringValue(item.revised_prompt)
    });
  }
}

async function uploadReferenceFromRequest(request, ownerToken, host) {
  const { fields, files } = await readMultipartForm(request);
  const file = files.find((item) => item.fieldName === "image") || files[0];
  if (!file || !file.bytes || !file.bytes.length) {
    throw httpError(400, "missing_image", "请上传参考图片。");
  }
  if (!/^image\//i.test(file.type || "")) {
    throw httpError(400, "invalid_image", "参考图必须是图片文件。");
  }
  const config = getRuntimeConfig();
  const stored = storeReferenceImage(file, ownerToken, fields.name);
  if (config.imageHostMode === "imgbb") {
    try {
      return await uploadReferenceToImgbb(file, fields.name, config, stored.referenceId);
    } catch (error) {
      referenceImages.delete(stored.referenceId);
      throw error;
    }
  }
  const url = `http://${host}/api/reference-images/${encodeURIComponent(stored.referenceId)}`;
  return {
    referenceId: stored.referenceId,
    name: stored.name,
    type: stored.type,
    size: file.bytes.length,
    url,
    image_url: url
  };
}

function storeReferenceImage(file, ownerToken, rawName) {
  const referenceId = makeJobId();
  const item = {
    referenceId,
    ownerToken,
    name: safeFilename(rawName || file.filename || "reference"),
    type: file.type,
    bytes: file.bytes,
    createdAt: Date.now()
  };
  referenceImages.set(referenceId, item);
  return item;
}

function storedReferenceForRequest(image, ownerToken) {
  const referenceId = stringValue(image && image.referenceId).trim();
  if (!referenceId) return null;
  const stored = referenceImages.get(referenceId);
  if (!stored || stored.ownerToken !== ownerToken || !stored.bytes || !stored.bytes.length) return null;
  return stored;
}

async function uploadReferenceToImgbb(file, rawName, config, referenceId) {
  const key = stringValue(config.imageHostApiKey).trim();
  if (!key) {
    throw httpError(400, "missing_image_host_key", "图床 API Key 未配置。");
  }
  const endpoint = normalizeEndpoint(config.imageHostUploadUrl || "https://api.imgbb.com/1/upload");
  const url = new URL(endpoint);
  url.searchParams.set("key", key);
  const expiration = clampInt(config.imageHostExpirationSeconds, 0, 15552000, 0);
  if (expiration >= 60) url.searchParams.set("expiration", String(expiration));

  const form = new FormData();
  const blob = new Blob([file.bytes], { type: file.type || "image/png" });
  form.append("image", blob, safeFilename(file.filename || rawName || "reference.png"));
  const name = safeUploadName(rawName || file.filename || "");
  if (name) form.append("name", name);

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutSeconds * 1000);
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw httpError(504, "image_host_timeout", "图床上传超时，请检查图床配置或稍后重试。");
    }
    throw httpError(502, "image_host_unreachable", `图床连接失败：${error.message || String(error)}`);
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
    const message = imageHostErrorMessage(payload) || `图床上传失败，HTTP ${response.status}。`;
    throw httpError(502, "image_host_failed", message);
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
    throw httpError(502, "image_host_missing_url", "图床上传成功但没有返回图片 URL。");
  }
  return {
    referenceId,
    host: "imgbb",
    name: safeFilename(file.filename || rawName || data.title || "reference"),
    type: file.type,
    size: file.bytes.length,
    url: imageUrl,
    image_url: imageUrl,
    viewer_url: data.url_viewer || "",
    delete_url: data.delete_url || ""
  };
}

function serveReferenceImage(response, referenceId) {
  const item = referenceImages.get(referenceId);
  if (!item) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    return response.end("reference image not found");
  }
  response.writeHead(200, {
    "Content-Type": item.type || "image/png",
    "Content-Length": item.bytes.length,
    "Cache-Control": "no-store"
  });
  response.end(item.bytes);
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    prompt: job.prompt,
    status: job.status,
    images: job.images,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function defaultRuntimeConfig() {
  const envKeys = parseApiKeys(process.env.IMAGE_API_KEYS, process.env.IMAGE_API_KEY);
  return {
    upstreamMode: (process.env.UPSTREAM_MODE || "live").toLowerCase() === "mock" ? "mock" : "live",
    baseUrl: normalizeEndpoint(process.env.IMAGE_API_BASE || "https://memefast.top/v1/images/generations"),
    imageEditUrl: normalizeEndpoint(process.env.IMAGE_EDIT_BASE || "https://memefast.top/v1/images/edits"),
    model: stringValue(process.env.IMAGE_MODEL).trim() || "gpt-image-2",
    imageModel: stringValue(process.env.IMAGE_MODEL_IMAGE || process.env.IMAGE_MODEL_FOR_IMAGE).trim() || "gpt-image-2",
    imageTransport: stringValue(process.env.IMAGE_TRANSPORT).trim() === "url" ? "url" : "edit",
    keyMode: envKeys.length > 1 ? "multi" : "single",
    apiKey: envKeys[0] || "",
    apiKeys: envKeys,
    imageHostMode: (process.env.IMAGE_HOST_MODE || "imgbb").toLowerCase() === "local" ? "local" : "imgbb",
    imageHostUploadUrl: normalizeEndpoint(process.env.IMGBB_UPLOAD_URL || "https://api.imgbb.com/1/upload"),
    imageHostApiKey: stringValue(process.env.IMGBB_API_KEY || process.env.IMAGE_HOST_API_KEY).trim(),
    imageHostExpirationSeconds: clampInt(process.env.IMGBB_EXPIRATION_SECONDS, 0, 15552000, 0),
    maxConcurrency: parseMaxConcurrency(process.env.MAX_CONCURRENCY, envKeys.length > 1 ? Math.min(envKeys.length, 5) : 1),
    requestTimeoutSeconds: clampInt(process.env.REQUEST_TIMEOUT_SECONDS, 10, 600, 180),
    retryAttempts: clampInt(process.env.UPSTREAM_RETRY_ATTEMPTS, 1, 5, 5)
  };
}

async function loadRuntimeConfig() {
  const defaults = defaultRuntimeConfig();
  if (!existsSync(CONFIG_FILE)) return defaults;
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    return sanitizeRuntimeConfig(raw, defaults);
  } catch (error) {
    console.warn("[gateway] failed to load runtime config, using env/defaults", {
      configFile: CONFIG_FILE,
      message: error.message
    });
    return defaults;
  }
}

async function saveRuntimeConfig(config) {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function sanitizeRuntimeConfig(value, defaults = defaultRuntimeConfig()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const baseUrl = normalizeEndpoint(source.baseUrl || defaults.baseUrl);
  const keyMode = source.keyMode === "multi" ? "multi" : "single";
  const apiKeys = parseApiKeys(source.apiKeys, source.apiKey);
  const singleKey = stringValue(source.apiKey).trim() || apiKeys[0] || "";
  const maxConcurrencyFallback = keyMode === "multi" && apiKeys.length ? Math.min(apiKeys.length, 5) : 1;
  return {
    upstreamMode: source.upstreamMode === "mock" ? "mock" : "live",
    baseUrl,
    imageEditUrl: normalizeEndpoint(source.imageEditUrl || defaults.imageEditUrl || "https://memefast.top/v1/images/edits"),
    model: stringValue(source.model).trim() || defaults.model || "gpt-image-2",
    imageModel: stringValue(source.imageModel).trim() || defaults.imageModel || "gpt-image-2",
    imageTransport: source.imageTransport === "url" ? "url" : "edit",
    keyMode,
    apiKey: keyMode === "single" ? singleKey : "",
    apiKeys: keyMode === "multi" ? apiKeys : singleKey ? [singleKey] : [],
    imageHostMode: source.imageHostMode === "local" ? "local" : "imgbb",
    imageHostUploadUrl: normalizeEndpoint(source.imageHostUploadUrl || defaults.imageHostUploadUrl || "https://api.imgbb.com/1/upload"),
    imageHostApiKey: stringValue(source.imageHostApiKey).trim() || defaults.imageHostApiKey || "",
    imageHostExpirationSeconds: clampInt(source.imageHostExpirationSeconds, 0, 15552000, defaults.imageHostExpirationSeconds || 0),
    maxConcurrency: parseMaxConcurrency(source.maxConcurrency, maxConcurrencyFallback),
    requestTimeoutSeconds: clampInt(source.requestTimeoutSeconds, 10, 600, defaults.requestTimeoutSeconds || 180),
    retryAttempts: clampInt(source.retryAttempts, 1, 5, defaults.retryAttempts || 5)
  };
}

function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    throw httpError(400, "invalid_base_url", "Base URL 必须是 http 或 https 地址。");
  }
  return endpoint.replace(/\/+$/, "");
}

function getRuntimeConfig() {
  return runtimeConfig || defaultRuntimeConfig();
}

function activeKeys(config = getRuntimeConfig()) {
  if (config.keyMode === "multi") return parseApiKeys(config.apiKeys, "");
  return config.apiKey ? [config.apiKey] : [];
}

function nextImageApiCredential() {
  const keys = activeKeys();
  if (!keys.length) return null;
  const index = upstreamKeyCursor % keys.length;
  upstreamKeyCursor = (upstreamKeyCursor + 1) % Number.MAX_SAFE_INTEGER;
  return {
    key: keys[index],
    index: index + 1,
    total: keys.length
  };
}

function configResponse(request) {
  const config = getRuntimeConfig();
  const host = request.headers.host || `${HOST}:${PORT}`;
  return {
    config: {
      ...config,
      upstreamKeyCount: activeKeys(config).length
    },
    paths: requestPaths(host, config),
    configFile: CONFIG_FILE
  };
}

function requestPaths(host, config = getRuntimeConfig()) {
  return {
    createJob: `POST http://${host}/api/image-jobs`,
    getJob: `GET http://${host}/api/image-jobs/<jobId>`,
    config: `GET/POST http://${host}/api/config`,
    uploadReference: `POST http://${host}/api/reference-images`,
    imageHost: config.imageHostMode === "local" ? `GET http://${host}/api/reference-images/<referenceId>` : config.imageHostUploadUrl,
    textUpstream: `POST ${config.baseUrl}`,
    imageUpstream: config.imageTransport === "edit" ? `POST ${config.imageEditUrl}` : `POST ${config.baseUrl}`,
    configFile: CONFIG_FILE
  };
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw httpError(413, "body_too_large", "请求体过大。");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw httpError(400, "invalid_json", "请求体不是合法 JSON。");
  }
}

async function readMultipartForm(request) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw httpError(400, "invalid_multipart", "请求体不是合法 multipart/form-data。");
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw httpError(413, "body_too_large", "请求体过大。");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const fields = {};
  const files = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(boundary, cursor);
    if (start === -1) break;
    cursor = start + boundary.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const rawHeaders = body.slice(cursor, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;
    let part = body.slice(headerEnd + 4, nextBoundary);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.slice(0, -2);
    }
    const disposition = rawHeaders.match(/content-disposition:\s*form-data;([^\r\n]+)/i);
    const name = disposition && disposition[1].match(/name="([^"]+)"/i);
    const filename = disposition && disposition[1].match(/filename="([^"]*)"/i);
    const type = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
    const fieldName = name ? name[1] : "";
    if (filename) {
      files.push({
        fieldName,
        filename: safeFilename(filename[1] || "upload"),
        type: type ? type[1].trim().toLowerCase() : "application/octet-stream",
        bytes: part
      });
    } else if (fieldName) {
      fields[fieldName] = part.toString("utf8");
    }
    cursor = nextBoundary;
  }
  return { fields, files };
}

function ensureOwner(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const existing = cookies[OWNER_COOKIE];
  if (existing && /^[A-Za-z0-9_-]{32,128}$/.test(existing)) {
    return { ownerToken: existing, isNewOwner: false };
  }
  return {
    ownerToken: randomBytes(32).toString("base64url"),
    isNewOwner: true
  };
}

function setOwnerCookie(response, ownerToken) {
  response.setHeader("Set-Cookie", `${OWNER_COOKIE}=${ownerToken}; Path=/; SameSite=Lax; HttpOnly`);
}

function parseCookies(header) {
  const cookies = {};
  header.split(";").forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return;
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
  });
  return cookies;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function httpError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, details);
  return error;
}

function makeJobId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = typeof randomUUID === "function" ? randomUUID() : randomBytes(32).toString("base64url");
    if (!jobs.has(id) && !referenceImages.has(id)) return id;
  }
  return randomBytes(32).toString("base64url");
}

function cleanExpiredRecords() {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if ((job.status === "succeeded" || job.status === "failed") && now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(jobId);
    }
  }
  for (const [referenceId, item] of referenceImages.entries()) {
    if (now - item.createdAt > REFERENCE_TTL_MS) {
      referenceImages.delete(referenceId);
    }
  }
}

function mockSvg(prompt, jobId, index, mode) {
  const colors = mode === "image"
    ? ["#f5efe7", "#b65f4b", "#264653"]
    : ["#eef4ff", "#0057df", "#8f5700"];
  const escapedPrompt = escapeXml(prompt).slice(0, 160);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" rx="32" fill="url(#bg)"/>
  <circle cx="1060" cy="148" r="92" fill="${colors[1]}" opacity=".16"/>
  <circle cx="160" cy="590" r="136" fill="${colors[2]}" opacity=".12"/>
  <rect x="126" y="116" width="1028" height="488" rx="34" fill="#ffffff" opacity=".72"/>
  <text x="168" y="224" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#2c2c31">Mock 返图预览 ${index}</text>
  <text x="168" y="310" font-family="Arial, sans-serif" font-size="34" fill="#3f414a">${escapedPrompt}</text>
  <text x="168" y="404" font-family="Arial, sans-serif" font-size="24" fill="#6f707d">任务 ${escapeXml(jobId.slice(0, 8))} · ${mode === "image" ? "图生图" : "文生图"} · 本地调试</text>
</svg>`;
}

function walk(value, visitor, depth = 0) {
  if (depth > 7 || value == null) return;
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor, depth + 1));
  } else if (typeof value === "object") {
    Object.values(value).forEach((item) => walk(item, visitor, depth + 1));
  }
}

function cleanBase64(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/")) return trimmed.split(",")[1] || "";
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 100) {
    return trimmed.replace(/\s/g, "");
  }
  return "";
}

function errorToMessage(error) {
  if (!error) return "未知错误。";
  if (error.message) return error.message;
  return String(error);
}

function upstreamErrorDetail(json, rawText, fallback) {
  const candidates = [];
  collectErrorText(json && json.error, candidates);
  collectErrorText(json && json.message, candidates);
  collectErrorText(json && json.detail, candidates);
  collectErrorText(json && json.rawText, candidates);
  collectErrorText(rawText, candidates);
  collectErrorText(fallback, candidates);
  return sanitizeErrorText(candidates.find(Boolean) || "上游请求失败。");
}

function imageHostErrorMessage(json) {
  const candidates = [];
  collectErrorText(json && json.error, candidates);
  collectErrorText(json && json.status_txt, candidates);
  collectErrorText(json && json.message, candidates);
  return sanitizeErrorText(candidates.find(Boolean));
}

function collectErrorText(value, candidates, depth = 0) {
  if (value == null || depth > 3) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    candidates.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectErrorText(item, candidates, depth + 1));
    return;
  }
  if (typeof value === "object") {
    ["message", "detail", "code", "type", "param", "rawText"].forEach((key) => collectErrorText(value[key], candidates, depth + 1));
    if (!candidates.length) {
      try {
        candidates.push(JSON.stringify(value));
      } catch {
        candidates.push(String(value));
      }
    }
  }
}

function sanitizeErrorText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function enumValue(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function parseBytes(value) {
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/i);
  if (!match) return 50 * 1024 * 1024;
  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  const multiplier = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return Math.floor(amount * multiplier);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function parseApiKeys(listValue, singleValue) {
  const keys = [];
  const seen = new Set();
  const add = (value) => {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  add(singleValue);
  if (Array.isArray(listValue)) {
    listValue.forEach(add);
  } else {
    String(listValue || "").split(/[\s,;|]+/).forEach(add);
  }
  return keys;
}

function parseMaxConcurrency(value, fallback) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "0" || text === "unlimited" || text === "infinite" || text === "infinity" || text === "none") {
    return Number.POSITIVE_INFINITY;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.floor(number));
}

function formatMaxConcurrency(value) {
  return Number.isFinite(value) ? String(value) : "unlimited";
}

function safeFilename(name) {
  return String(name || "image.png").replace(/[\\/:*?"<>|]+/g, "-");
}

function safeUploadName(name) {
  const base = safeFilename(name || "")
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "";
}

function mimeFromFormat(format) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  if (format === "svg" || format === "image/svg+xml") return "image/svg+xml";
  return "image/png";
}

function imageMime(item, fallbackFormat) {
  if (typeof item.mime === "string" && /^image\//.test(item.mime)) return item.mime;
  if (typeof item.type === "string" && /^image\//.test(item.type)) return item.type;
  return mimeFromFormat(item.output_format || item.format || fallbackFormat);
}

function extensionFromMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  return extname(mime).slice(1) || "png";
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  }[char]));
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function serveConfigPage(request, response) {
  const html = configPageHtml(request.headers.host || `${HOST}:${PORT}`);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

function configPageHtml(host) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>生图网关配置</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f2efe8;
      --card: #fffdfa;
      --text: #17202b;
      --muted: #607086;
      --line: #d8ddd7;
      --line-strong: #c8d1cd;
      --primary: #157a91;
      --primary-strong: #0f6578;
      --ok: #2f7d42;
      --bad: #ad3b3b;
      --input: #ffffff;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at top left, rgba(21, 122, 145, .08), transparent 28%), var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .wrap {
      width: min(1040px, calc(100vw - 48px));
      margin: 16px auto 40px;
      background: var(--card);
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      box-shadow: 0 28px 70px rgba(55, 48, 35, .08);
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding: 22px 30px 20px;
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 32px;
      line-height: 1.12;
      font-weight: 900;
    }
    .sub {
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
    }
    .status {
      min-width: 96px;
      text-align: right;
      color: #40566a;
      font-size: 15px;
      line-height: 1.55;
      font-weight: 700;
    }
    main {
      padding: 22px 30px 24px;
    }
    label {
      display: grid;
      gap: 8px;
      margin-bottom: 18px;
      font-size: 14px;
      font-weight: 900;
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: var(--input);
      color: var(--text);
      font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      padding: 11px 14px;
      outline: none;
    }
    textarea { min-height: 132px; resize: vertical; }
    input:focus, textarea:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(21, 122, 145, .14);
    }
    .hint {
      margin-top: -8px;
      margin-bottom: 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
      font-weight: 700;
    }
    .panel {
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      padding: 15px 18px;
      margin-bottom: 20px;
      background: #fffefb;
    }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 18px;
      line-height: 1.2;
    }
    .path-grid {
      display: grid;
      grid-template-columns: 150px 1fr;
      gap: 10px 22px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 800;
    }
    .path-grid code {
      color: var(--text);
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      word-break: break-all;
    }
    .tabs {
      width: 430px;
      max-width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      overflow: hidden;
      margin: 0 0 18px;
      background: #ffffff;
    }
    .tabs button {
      border: 0;
      min-height: 38px;
      background: transparent;
      color: var(--muted);
      font-weight: 900;
      cursor: pointer;
    }
    .tabs button.active {
      background: var(--primary);
      color: #ffffff;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
    }
    button.primary, button.secondary {
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      min-height: 42px;
      padding: 0 20px;
      font-size: 14px;
      font-weight: 900;
      cursor: pointer;
    }
    button.primary {
      border-color: var(--primary);
      background: var(--primary);
      color: #ffffff;
    }
    button.primary:hover { background: var(--primary-strong); }
    button.secondary {
      background: #ffffff;
      color: var(--text);
    }
    #feedback {
      margin-left: auto;
      color: var(--muted);
      font-size: 14px;
      font-weight: 800;
    }
    #feedback.good { color: var(--ok); }
    #feedback.bad { color: var(--bad); }
    @media (max-width: 760px) {
      .wrap { width: calc(100vw - 24px); margin-top: 12px; }
      header, main { padding-left: 18px; padding-right: 18px; }
      header { flex-direction: column; }
      .status { text-align: left; }
      .grid-2, .path-grid { grid-template-columns: 1fr; }
      .actions { flex-wrap: wrap; }
      #feedback { width: 100%; margin-left: 0; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>生图网关配置</h1>
        <div class="sub">局域网可访问 · 无密码 · 保存后立即生效</div>
      </div>
      <div class="status"><div id="modeText">live</div><div id="keyCount">0 key</div></div>
    </header>
    <main>
      <label>
        Base URL
        <input id="baseUrl" spellcheck="false" autocomplete="off">
      </label>
      <label>
        图生图编辑 URL
        <input id="imageEditUrl" spellcheck="false" autocomplete="off">
      </label>
      <label>
        默认模型
        <input id="model" spellcheck="false" autocomplete="off">
      </label>
      <label>
        图生图模型
        <input id="imageModel" spellcheck="false" autocomplete="off">
      </label>
      <label>
        图生图通道
        <select id="imageTransport">
          <option value="edit">edits 文件上传</option>
          <option value="url">generations URL 数组</option>
        </select>
      </label>
      <p class="hint">当前默认按 /v1/images/edits 提交参考图文件；URL 数组模式用于 gpt-image-2-all 可用时。</p>

      <section class="panel">
        <h2>请求路径</h2>
        <div class="path-grid" id="pathGrid"></div>
      </section>

      <section class="panel">
        <h2>参考图图床</h2>
        <div class="grid-2">
          <label>
            图床模式
            <select id="imageHostMode">
              <option value="imgbb">imgbb</option>
              <option value="local">local</option>
            </select>
          </label>
          <label>
            过期秒数
            <input id="imageHostExpirationSeconds" type="number" min="0" step="60">
          </label>
        </div>
        <label>
          imgbb 上传端点
          <input id="imageHostUploadUrl" spellcheck="false" autocomplete="off">
        </label>
        <label>
          imgbb API Key
          <input id="imageHostApiKey" spellcheck="false" autocomplete="off">
        </label>
        <p class="hint">edits 文件上传通道可用 local；URL 数组通道需要 imgbb 这类公网图床。</p>
      </section>

      <div class="tabs">
        <button id="singleTab" type="button">单 key</button>
        <button id="multiTab" type="button">多 key</button>
      </div>

      <label id="singleKeyField">
        API Key
        <input id="apiKey" spellcheck="false" autocomplete="off">
      </label>
      <label id="multiKeyField" hidden>
        API Keys
        <textarea id="apiKeys" spellcheck="false" autocomplete="off" placeholder="一行一个 key，也支持逗号、分号或空格分隔"></textarea>
      </label>

      <div class="grid-2">
        <label>
          并发数
          <input id="maxConcurrency" type="number" min="1" step="1">
        </label>
        <label>
          请求超时秒数
          <input id="requestTimeoutSeconds" type="number" min="10" max="600" step="10">
        </label>
        <label>
          上游重试次数
          <input id="retryAttempts" type="number" min="1" max="5" step="1">
        </label>
        <label>
          请求模式
          <select id="upstreamMode">
            <option value="live">live</option>
            <option value="mock">mock</option>
          </select>
        </label>
      </div>

      <div class="actions">
        <button class="primary" id="saveBtn" type="button">保存</button>
        <button class="secondary" id="reloadBtn" type="button">重新载入</button>
        <span id="feedback"></span>
      </div>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    let keyMode = "single";

    $("singleTab").addEventListener("click", () => setKeyMode("single"));
    $("multiTab").addEventListener("click", () => setKeyMode("multi"));
    $("saveBtn").addEventListener("click", saveConfig);
    $("reloadBtn").addEventListener("click", reloadConfig);

    loadConfig();

    async function loadConfig() {
      setFeedback("正在载入配置。");
      const response = await fetch("/api/config", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error && payload.error.message || "载入失败");
      renderConfig(payload);
      setFeedback("");
    }

    async function reloadConfig() {
      setFeedback("正在重新载入。");
      const response = await fetch("/api/reload-config", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        setFeedback(payload.error && payload.error.message || "重新载入失败。", "bad");
        return;
      }
      renderConfig(payload);
      setFeedback(payload.message || "已重新载入。", "good");
    }

    async function saveConfig() {
      setFeedback("正在保存。");
      const payload = {
        upstreamMode: $("upstreamMode").value,
        baseUrl: $("baseUrl").value.trim(),
        imageEditUrl: $("imageEditUrl").value.trim(),
        model: $("model").value.trim(),
        imageModel: $("imageModel").value.trim(),
        imageTransport: $("imageTransport").value,
        keyMode,
        apiKey: $("apiKey").value.trim(),
        apiKeys: $("apiKeys").value.split(/[\\n,;\\s]+/).map((item) => item.trim()).filter(Boolean),
        imageHostMode: $("imageHostMode").value,
        imageHostUploadUrl: $("imageHostUploadUrl").value.trim(),
        imageHostApiKey: $("imageHostApiKey").value.trim(),
        imageHostExpirationSeconds: Number($("imageHostExpirationSeconds").value || 0),
        maxConcurrency: Number($("maxConcurrency").value || 1),
        requestTimeoutSeconds: Number($("requestTimeoutSeconds").value || 180),
        retryAttempts: Number($("retryAttempts").value || 5)
      };
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        setFeedback(result.error && result.error.message || "保存失败。", "bad");
        return;
      }
      renderConfig(result);
      setFeedback(result.message || "已保存并生效。", "good");
    }

    function renderConfig(payload) {
      const config = payload.config || {};
      $("baseUrl").value = config.baseUrl || "";
      $("imageEditUrl").value = config.imageEditUrl || "https://memefast.top/v1/images/edits";
      $("model").value = config.model || "";
      $("imageModel").value = config.imageModel || "gpt-image-2";
      $("imageTransport").value = config.imageTransport || "edit";
      $("upstreamMode").value = config.upstreamMode || "live";
      $("apiKey").value = config.apiKey || "";
      $("apiKeys").value = Array.isArray(config.apiKeys) ? config.apiKeys.join("\\n") : "";
      $("imageHostMode").value = config.imageHostMode || "imgbb";
      $("imageHostUploadUrl").value = config.imageHostUploadUrl || "https://api.imgbb.com/1/upload";
      $("imageHostApiKey").value = config.imageHostApiKey || "";
      $("imageHostExpirationSeconds").value = Number.isFinite(Number(config.imageHostExpirationSeconds)) ? Number(config.imageHostExpirationSeconds) : 0;
      $("maxConcurrency").value = Number.isFinite(Number(config.maxConcurrency)) ? Number(config.maxConcurrency) : 1;
      $("requestTimeoutSeconds").value = Number.isFinite(Number(config.requestTimeoutSeconds)) ? Number(config.requestTimeoutSeconds) : 180;
      $("retryAttempts").value = Number.isFinite(Number(config.retryAttempts)) ? Number(config.retryAttempts) : 5;
      $("modeText").textContent = config.upstreamMode || "live";
      $("keyCount").textContent = (config.upstreamKeyCount || 0) + " key";
      setKeyMode(config.keyMode === "multi" ? "multi" : "single");
      const paths = payload.paths || {};
      const rows = [
        ["创建任务", paths.createJob],
        ["查询任务", paths.getJob],
        ["配置接口", paths.config],
        ["参考图上传", paths.uploadReference],
        ["图床", paths.imageHost],
        ["文生图上游", paths.textUpstream],
        ["图生图上游", paths.imageUpstream],
        ["配置文件", payload.configFile]
      ];
      $("pathGrid").innerHTML = rows.map(([label, value]) => "<div>" + escapeHtml(label) + "</div><code>" + escapeHtml(value || "") + "</code>").join("");
    }

    function setKeyMode(mode) {
      keyMode = mode === "multi" ? "multi" : "single";
      $("singleTab").classList.toggle("active", keyMode === "single");
      $("multiTab").classList.toggle("active", keyMode === "multi");
      $("singleKeyField").hidden = keyMode !== "single";
      $("multiKeyField").hidden = keyMode !== "multi";
    }

    function setFeedback(message, kind = "") {
      $("feedback").textContent = message || "";
      $("feedback").className = kind;
    }

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }
  </script>
</body>
</html>`;
}
