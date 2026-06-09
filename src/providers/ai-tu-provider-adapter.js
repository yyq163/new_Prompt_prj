import { ImageApiError, providerConfigMissing, providerTimeout, providerUnsupported } from "../core/errors.js";
import { intRange, parseAspectSize, stringValue, walk } from "../core/runtime.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const UPSTREAM_RETRY_BASE_DELAY_MS = 2000;
const UPSTREAM_RETRY_MAX_DELAY_MS = 30_000;
const AI_TU_DEFAULT_GENERATIONS_URL = "https://memefast.top/v1/images/generations";
let upstreamKeyCursor = 0;

export async function generateWithAiTuProvider({ request, compiledPrompt, fetchImpl = globalThis.fetch } = {}) {
  const config = defaultProviderConfig();
  if (!hasRequiredProviderConfig(config)) providerConfigMissing();

  const providerRequest = {
    model: request.generation_mode === "image_to_image" ? config.imageModel : config.model,
    prompt: compiledPrompt,
    n: request.output.count,
    size: parseAspectSize(request.output.aspect_ratio),
    quality: request.output.quality,
    output_format: "png",
    mode: request.generation_mode === "image_to_image" ? "image" : "text",
    images: (request.references || []).map((item) => ({ image_url: item.url, url: item.url }))
  };

  const images = request.generation_mode === "image_to_image"
    ? await postLiveImageUrlJson(providerRequest, config, fetchImpl)
    : await postLiveJson(config.baseUrl, baseUpstreamPayload(providerRequest), fetchImpl);

  if (!images.length) {
    throw new ImageApiError({
      statusCode: 502,
      status: "failed",
      errorCode: "IMAGE_RESULT_EMPTY",
      message: "上游没有返回图片结果。"
    });
  }

  return {
    status: "succeeded",
    images: images.map((image, index) => ({
      image_id: image.image_id || `img_${String(index + 1).padStart(3, "0")}`,
      url: image.url,
      width: image.width || null,
      height: image.height || null,
      format: image.format || inferFormat(image.url) || "png"
    }))
  };
}

export function baseUpstreamPayload(request) {
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

export async function postLiveJson(kind, payload, fetchImpl = globalThis.fetch) {
  const body = JSON.stringify(payload);
  const json = await fetchUpstream(kind, (credential) => ({
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.key}`,
      "Content-Type": "application/json"
    },
    body
  }), fetchImpl);
  return normalizeProviderResult(json, payload.format);
}

export async function postLiveImageUrlJson(request, config = defaultProviderConfig(), fetchImpl = globalThis.fetch) {
  const referenceUrls = request.images
    .map((image) => image.image_url || image.url)
    .filter(Boolean);
  if (!referenceUrls.length) {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "REFERENCE_REQUIRED",
      message: "图生图需要至少一张参考图 URL。"
    });
  }
  const count = Math.max(1, Math.min(request.n || 1, 16));
  const slots = Array.from({ length: count });
  const batches = await mapWithConcurrency(slots, Math.min(2, count), () => (
    postSingleLiveImageUrlJson(request, referenceUrls, config, 1, fetchImpl)
  ));
  return batches.flat().slice(0, count);
}

export async function postSingleLiveImageUrlJson(request, referenceUrls, config, count, fetchImpl = globalThis.fetch) {
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
  }), fetchImpl, config);
  return normalizeProviderResult(json, request.output_format);
}

export async function fetchUpstream(kind, initFactory, fetchImpl = globalThis.fetch, config = defaultProviderConfig()) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    const credential = nextImageApiCredential(config);
    try {
      const init = typeof initFactory === "function" ? initFactory(credential) : initFactory;
      if (!credential) providerConfigMissing();
      return await fetchUpstreamOnce(kind, init, fetchImpl, config);
    } catch (error) {
      lastError = error;
      if (!isRetryableUpstreamError(error) || attempt === config.retryAttempts) break;
      await sleep(retryDelayMs(error, attempt));
    }
  }
  throw mapProviderError(lastError);
}

export async function fetchUpstreamOnce(kind, init, fetchImpl = globalThis.fetch, config = defaultProviderConfig()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutSeconds * 1000);
  try {
    const response = await fetchImpl(resolveUpstreamUrl(kind, config), {
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
      throw upstreamHttpError(response, json, text, kind);
    }
    return json;
  } catch (error) {
    if (error && error.name === "AbortError") providerTimeout();
    if (error instanceof ImageApiError) throw error;
    if (String(error?.message || "").toLowerCase() === "terminated") {
      throw upstreamSyntheticError(502, "upstream_terminated", "上游图片生成连接提前中断。");
    }
    if (String(error?.message || "").toLowerCase() === "fetch failed") {
      throw upstreamSyntheticError(502, "upstream_unreachable", "上游图片生成连接失败。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function isRetryableUpstreamError(error) {
  if (!error || typeof error.status !== "number") return false;
  return error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
}

export function retryDelayMs(error, attempt) {
  const retryAfterMs = Number(error && error.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(UPSTREAM_RETRY_MAX_DELAY_MS, Math.max(1000, retryAfterMs));
  }
  return Math.min(UPSTREAM_RETRY_MAX_DELAY_MS, UPSTREAM_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
}

export function parseRetryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds * 1000));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, timestamp - Date.now());
}

export function resolveUpstreamUrl(kind, config = defaultProviderConfig()) {
  if (/^https?:\/\//i.test(kind)) return kind;
  return config.baseUrl;
}

export function extractImageUrls(json, format = "png") {
  const found = [];
  const seen = new Set();
  let unsupportedImagePayloadFound = false;

  if (Array.isArray(json && json.data)) {
    json.data.forEach((item) => pushImage(item));
  }

  walk(json, (node) => {
    if (!node || typeof node !== "object") return;
    if (node.b64_json || node.base64 || node.image_base64 || node.binary || node.result) {
      unsupportedImagePayloadFound = true;
    }
    if (node.url || node.image_url || node.output_url) {
      pushImage(node);
    }
    if (Array.isArray(node.images)) node.images.forEach(pushImage);
  });

  if (!found.length && unsupportedImagePayloadFound) providerUnsupported();
  if (!found.length) {
    throw new ImageApiError({
      statusCode: 502,
      status: "failed",
      errorCode: "IMAGE_RESULT_EMPTY",
      message: "接口返回里没有找到可访问的图片 URL。"
    });
  }
  return found;

  function pushImage(item) {
    if (!item || typeof item !== "object") return;
    const url = [item.url, item.image_url, item.output_url].find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
    if (!url || seen.has(url)) return;
    seen.add(url);
    found.push({
      url,
      width: finiteNumber(item.width),
      height: finiteNumber(item.height),
      format: stringValue(item.format).trim() || inferFormat(url) || format
    });
  }
}

export async function normalizeProviderResult(json, format = "png", fetchImpl = globalThis.fetch, config = defaultProviderConfig()) {
  const immediate = extractImageUrlsAllowEmpty(json, format);
  if (immediate.status === "ok") return immediate.images;
  if (immediate.status === "unsupported") providerUnsupported();

  const asyncHandle = findAsyncHandle(json);
  if (!asyncHandle) extractImageUrls(json, format);
  return pollProviderResult(asyncHandle, format, fetchImpl, config);
}

function extractImageUrlsAllowEmpty(json, format) {
  try {
    return { status: "ok", images: extractImageUrls(json, format) };
  } catch (error) {
    if (error instanceof ImageApiError && error.errorCode === "PROVIDER_RESPONSE_UNSUPPORTED") return { status: "unsupported", images: [] };
    if (error instanceof ImageApiError && error.errorCode === "IMAGE_RESULT_EMPTY") return { status: "empty", images: [] };
    throw error;
  }
}

function findAsyncHandle(json) {
  if (!json || typeof json !== "object") return null;
  const statusUrl = stringValue(json.status_url || json.statusUrl || json.poll_url || json.pollUrl).trim();
  const id = stringValue(json.job_id || json.task_id || json.request_id || json.id).trim();
  if (statusUrl && /^https?:\/\//i.test(statusUrl)) return { statusUrl, id };
  if (id) return { id };
  return null;
}

async function pollProviderResult(handle, format, fetchImpl, config = defaultProviderConfig()) {
  const deadline = Date.now() + config.pollTimeoutSeconds * 1000;
  const intervalMs = Math.max(1000, config.pollIntervalSeconds * 1000);
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const endpoint = handle.statusUrl || buildPollUrl(config, handle.id);
    if (!endpoint) break;
    const json = await fetchUpstream(endpoint, (credential) => ({
      method: "GET",
      headers: {
        "Authorization": `Bearer ${credential.key}`
      }
    }), fetchImpl, config);
    const result = extractImageUrlsAllowEmpty(json, format);
    if (result.status === "ok") return result.images;
    if (result.status === "unsupported") providerUnsupported();
  }
  providerTimeout();
}

function buildPollUrl(config, id) {
  if (!id || !config.pollBaseUrl) return "";
  return `${config.pollBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(id)}`;
}

export function defaultProviderConfig() {
  const fileConfig = loadAiTuRuntimeConfig();
  const envKeys = parseApiKeys(process.env.IMAGE_API_KEYS, process.env.IMAGE_API_KEY);
  const fileKeys = parseApiKeys(fileConfig.apiKeys, fileConfig.apiKey);
  const keys = envKeys.length ? envKeys : fileKeys;
  const baseUrl = stringValue(process.env.IMAGE_API_BASE).trim() || stringValue(fileConfig.baseUrl).trim() || AI_TU_DEFAULT_GENERATIONS_URL;
  const fileImageModel = stringValue(fileConfig.imageModel).trim();
  const model = stringValue(process.env.IMAGE_MODEL).trim() || stringValue(fileConfig.model).trim() || fileImageModel;
  return sanitizeProviderConfig({
    baseUrl,
    model,
    imageModel: stringValue(process.env.IMAGE_MODEL_IMAGE || process.env.IMAGE_MODEL_FOR_IMAGE).trim() || stringValue(fileConfig.imageModel).trim() || model,
    keyMode: keys.length > 1 || fileConfig.keyMode === "multi" ? "multi" : "single",
    apiKey: keys[0] || "",
    apiKeys: keys,
    requestTimeoutSeconds: process.env.REQUEST_TIMEOUT_SECONDS || fileConfig.requestTimeoutSeconds,
    retryAttempts: process.env.UPSTREAM_RETRY_ATTEMPTS || fileConfig.retryAttempts,
    pollTimeoutSeconds: process.env.IMAGE_PROVIDER_POLL_TIMEOUT_SECONDS || fileConfig.pollTimeoutSeconds,
    pollIntervalSeconds: process.env.IMAGE_PROVIDER_POLL_INTERVAL_SECONDS || fileConfig.pollIntervalSeconds,
    pollBaseUrl: stringValue(process.env.IMAGE_PROVIDER_POLL_BASE).trim() || stringValue(fileConfig.pollBaseUrl).trim()
  });
}

export function loadAiTuRuntimeConfig() {
  const candidates = [
    stringValue(process.env.AI_TU_RUNTIME_CONFIG_FILE).trim(),
    resolve("ai-tu/runtime-config.json")
  ].filter(Boolean);
  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue;
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

export function sanitizeProviderConfig(source) {
  const value = source && typeof source === "object" ? source : {};
  const baseUrl = value.baseUrl ? normalizeEndpoint(value.baseUrl) : "";
  const keyMode = value.keyMode === "multi" ? "multi" : "single";
  const apiKeys = parseApiKeys(value.apiKeys, value.apiKey);
  const singleKey = stringValue(value.apiKey).trim() || apiKeys[0] || "";
  const pollBaseUrl = value.pollBaseUrl ? normalizeEndpoint(value.pollBaseUrl) : "";
  return {
    baseUrl,
    model: stringValue(value.model).trim(),
    imageModel: stringValue(value.imageModel).trim() || stringValue(value.model).trim(),
    keyMode,
    apiKey: keyMode === "single" ? singleKey : "",
    apiKeys: keyMode === "multi" ? apiKeys : singleKey ? [singleKey] : [],
    requestTimeoutSeconds: intRange(value.requestTimeoutSeconds, 10, 600, 180),
    retryAttempts: intRange(value.retryAttempts, 1, 5, 5),
    pollTimeoutSeconds: intRange(value.pollTimeoutSeconds, 10, 900, 180),
    pollIntervalSeconds: intRange(value.pollIntervalSeconds, 1, 30, 2),
    pollBaseUrl
  };
}

export function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "INVALID_REQUEST_SCHEMA",
      message: "Provider endpoint 必须是 http 或 https 地址。"
    });
  }
  return endpoint.replace(/\/+$/, "");
}

export function activeKeys(config = defaultProviderConfig()) {
  if (config.keyMode === "multi") return parseApiKeys(config.apiKeys, "");
  return config.apiKey ? [config.apiKey] : [];
}

export function hasRequiredProviderConfig(config = defaultProviderConfig()) {
  return Boolean(config.baseUrl && config.model && activeKeys(config).length);
}

export function nextImageApiCredential(config = defaultProviderConfig()) {
  const keys = activeKeys(config);
  if (!keys.length) return null;
  const index = upstreamKeyCursor % keys.length;
  upstreamKeyCursor = (upstreamKeyCursor + 1) % Number.MAX_SAFE_INTEGER;
  return {
    key: keys[index],
    index: index + 1,
    total: keys.length
  };
}

function parseApiKeys(...values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : stringValue(value).split(/[,\n]/))
    .map((item) => stringValue(item).trim())
    .filter(Boolean);
}

function upstreamHttpError(response, json, text, kind) {
  const error = upstreamSyntheticError(response.status, "upstream_failed", `请求失败 ${response.status}：${upstreamErrorDetail(json, text, response.statusText)}`);
  error.upstreamEndpoint = kind;
  error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  return error;
}

function upstreamSyntheticError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function mapProviderError(error) {
  if (error instanceof ImageApiError) return error;
  if (error?.status === 504) {
    return new ImageApiError({ statusCode: 504, status: "failed", errorCode: "IMAGE_PROVIDER_TIMEOUT", message: "图片生成超时，请稍后重试。" });
  }
  return new ImageApiError({
    statusCode: error?.status && error.status >= 400 ? 502 : 500,
    status: "failed",
    errorCode: "IMAGE_PROVIDER_CALL_FAILED",
    message: "图片生成 provider 调用失败。"
  });
}

function upstreamErrorDetail(json, text, statusText) {
  const candidates = [
    json?.error?.message,
    json?.message,
    json?.detail,
    statusText,
    text && text.slice(0, 200)
  ].filter(Boolean);
  return stringValue(candidates[0] || "unknown upstream error").slice(0, 300);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inferFormat(url) {
  const clean = String(url || "").split("?")[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  if (!match) return "";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(match[1])) return match[1] === "jpg" ? "jpeg" : match[1];
  return "";
}
