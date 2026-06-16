import { ImageApiError, providerConfigMissing, providerUnsupported } from "../core/errors.js";
import { intRange, parseAspectSize, stringValue } from "../core/runtime.js";
import { isUnsafeNetworkHost, normalizePublicHttpUrl } from "../core/url-security.js";
import {
  DEFAULT_GENERATED_IMAGE_MAX_BYTES,
  GENERATED_IMAGE_ALLOWED_MIME_TYPES,
  detectImageMime,
  normalizeImageBytes
} from "../core/generated-image-store.js";
import { normalizeProviderImages } from "./provider-result-normalizer.js";
export { normalizeProviderImageObject } from "./provider-result-normalizer.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const UPSTREAM_RETRY_BASE_DELAY_MS = 2000;
const UPSTREAM_RETRY_MAX_DELAY_MS = 30_000;
const AI_TU_DEFAULT_GENERATIONS_URL = "https://memefast.top/v1/images/generations";
const AI_TU_DEFAULT_EDITS_URL = "https://memefast.top/v1/images/edits";
const FIXED_IMAGE_MODEL = "gpt-image-2";
const PROVIDER_PROMPT_MAX_CHARS = 1000;
const LONG_RUNNING_SUBMIT_MIN_TIMEOUT_SECONDS = 600;
const DEFAULT_REFERENCE_FETCH_TIMEOUT_SECONDS = 30;
let upstreamKeyCursor = 0;

export async function generateWithAiTuProvider({ request, compiledPrompt, fetchImpl = globalThis.fetch } = {}) {
  const config = defaultProviderConfig();
  if (!hasRequiredProviderConfig(config)) providerConfigMissing();

  const references = request.references || [];
  const hasReferenceImages = references.length > 0;
  const providerRequest = {
    model: FIXED_IMAGE_MODEL,
    prompt: providerPrompt(compiledPrompt),
    n: request.output.count,
    size: parseAspectSize(request.output.aspect_ratio),
    aspect_ratio: request.output.aspect_ratio,
    quality: request.output.quality,
    output_format: "png",
    mode: hasReferenceImages ? "image" : "text",
    images: references.map((item) => ({ image_url: item.url, url: item.url }))
  };

  const images = config.imageTransport === "url"
    ? hasReferenceImages
      ? await postLiveImageUrlJson(providerRequest, config, fetchImpl)
      : await postLiveJson(config.baseUrl, toapisGenerationPayload(providerRequest), fetchImpl, config)
    : hasReferenceImages
      ? await postLiveImageEditMultipart(providerRequest, config, fetchImpl)
    : await postLiveJson(config.baseUrl, baseUpstreamPayload(providerRequest), fetchImpl, config);

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

export function toapisGenerationPayload(request) {
  const payload = {
    model: request.model,
    prompt: request.prompt,
    n: request.n,
    size: normalizeToapisAspectRatio(request.aspect_ratio),
    resolution: "1K",
    response_format: "url"
  };
  if (request.quality && request.quality !== "auto") payload.quality = request.quality;
  return payload;
}

export function providerPrompt(value) {
  const text = stringValue(value).trim();
  if (text.length <= PROVIDER_PROMPT_MAX_CHARS) return text;
  return text.slice(0, PROVIDER_PROMPT_MAX_CHARS);
}

function normalizeToapisAspectRatio(value) {
  const text = stringValue(value).trim();
  return /^(1:1|16:9|9:16|4:3|3:4)$/.test(text) ? text : "1:1";
}

export async function postLiveJson(kind, payload, fetchImpl = globalThis.fetch, config = defaultProviderConfig()) {
  const body = JSON.stringify(payload);
  const submitConfig = longRunningSubmitConfig(config);
  const json = await fetchUpstream(kind, (credential) => ({
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "identity",
      "Authorization": `Bearer ${credential.key}`,
      "Connection": "close",
      "Content-Type": "application/json"
    },
    body
  }), fetchImpl, submitConfig);
  return normalizeProviderResult(json, payload.format, fetchImpl, config);
}

export async function postLiveImageEditMultipart(request, config = defaultProviderConfig(), fetchImpl = globalThis.fetch) {
  if (!Array.isArray(request.images) || !request.images.length) {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "REFERENCE_REQUIRED",
      message: "图生图需要至少一张参考图 URL。"
    });
  }
  const count = Math.max(1, Math.min(request.n || 1, 16));
  const images = [];
  for (let index = 0; index < count; index += 1) {
    images.push(...await postSingleLiveImageEditMultipart(request, config, fetchImpl));
  }
  return images.slice(0, count);
}

export async function postLiveImageUrlJson(request, config = defaultProviderConfig(), fetchImpl = globalThis.fetch) {
  const referenceUrls = providerReferenceUrls(request.images);
  if (!referenceUrls.length) {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "REFERENCE_REQUIRED",
      message: "图生图需要至少一张参考图 URL。"
    });
  }
  const payload = {
    ...toapisGenerationPayload(request),
    reference_images: referenceUrls
  };
  const json = await fetchUpstream(config.baseUrl, (credential) => ({
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "identity",
      "Authorization": `Bearer ${credential.key}`,
      "Connection": "close",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }), fetchImpl, longRunningSubmitConfig(config));
  return normalizeProviderResult(json, request.output_format, fetchImpl, config);
}

export async function postSingleLiveImageEditMultipart(request, config = defaultProviderConfig(), fetchImpl = globalThis.fetch) {
  const form = new FormData();
  form.append("model", FIXED_IMAGE_MODEL);
  form.append("prompt", request.prompt);
  for (const image of request.images) {
    const referenceUrl = stringValue(image.image_url || image.url).trim();
    if (!referenceUrl) continue;
    const blob = await fetchReferenceImageBlob(referenceUrl, fetchImpl);
    form.append("image[]", blob, safeReferenceFilename(referenceUrl));
  }
  if (!hasFormImageFiles(form)) {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "REFERENCE_REQUIRED",
      message: "图生图需要至少一张参考图 URL。"
    });
  }
  const submitConfig = longRunningSubmitConfig(config);
  const json = await fetchUpstream(config.imageEditUrl, (credential) => ({
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.key}`
    },
    body: form
  }), fetchImpl, submitConfig);
  return normalizeProviderResult(json, request.output_format, fetchImpl, config);
}

function hasFormImageFiles(form) {
  for (const [key, value] of form.entries()) {
    if ((key === "image[]" || key === "image") && value && typeof value.arrayBuffer === "function") return true;
  }
  return false;
}

function providerReferenceUrls(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => stringValue(image?.image_url || image?.url).trim())
    .filter(Boolean)
    .map((url) => new URL(assertProviderReferenceUrlAllowed(url)).toString());
}

async function fetchReferenceImageBlob(url, fetchImpl = globalThis.fetch) {
  const safeUrl = assertProviderReferenceUrlAllowed(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), referenceFetchTimeoutMs());
  try {
    const response = await fetchImpl(safeUrl, { redirect: "manual", signal: controller.signal });
    if (!response || !response.ok) referenceImageNotAccessible();

    const maxBytes = referenceImageMaxBytes();
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) referenceImageTooLarge(maxBytes);

    const bytes = await readReferenceResponseBytes(response, maxBytes);
    const detectedMime = detectImageMime(bytes);
    if (!detectedMime || !GENERATED_IMAGE_ALLOWED_MIME_TYPES.includes(detectedMime)) {
      referenceImageUnsupported("参考图字节不是支持的 png、jpeg 或 webp 图片。");
    }
    const declaredMime = normalizeReferenceMime(response.headers?.get?.("content-type"));
    if (declaredMime && declaredMime !== detectedMime) {
      referenceImageUnsupported("参考图 MIME 类型与图片字节不匹配。");
    }
    return new Blob([bytes], { type: detectedMime });
  } catch (error) {
    if (error instanceof ImageApiError) throw error;
    referenceImageNotAccessible();
  } finally {
    clearTimeout(timeout);
  }
}

export function assertProviderReferenceUrlAllowed(value) {
  if (isLocalGeneratedImageStoreReferenceUrl(value)) {
    return normalizePublicHttpUrl(value, "reference.url", {
      allowLocal: true,
      statusCode: 400,
      errorCode: "REFERENCE_URL_INVALID"
    });
  }
  return normalizePublicHttpUrl(value, "reference.url", {
    allowLocal: process.env.ALLOW_LOCAL_REFERENCE_URLS === "true",
    statusCode: 400,
    errorCode: "REFERENCE_URL_INVALID"
  });
}

function isLocalGeneratedImageStoreReferenceUrl(value) {
  let parsed;
  try {
    parsed = new URL(stringValue(value).trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!/^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/i.test(parsed.pathname)) return false;
  if (!isUnsafeNetworkHost(parsed.hostname)) return false;
  const expectedPort = String(process.env.PORT || 8787);
  const parsedPort = parsed.port || (parsed.protocol === "http:" ? "80" : "443");
  if (parsedPort !== expectedPort) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const configuredHost = stringValue(process.env.HOST || "127.0.0.1").toLowerCase();
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (configuredHost && configuredHost !== "0.0.0.0" && configuredHost !== "::") allowedHosts.add(configuredHost);
  return allowedHosts.has(host);
}

async function readReferenceResponseBytes(response, maxBytes) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = normalizeImageBytes(value);
        total += chunk.length;
        if (total > maxBytes) referenceImageTooLarge(maxBytes);
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total);
  }
  const bytes = normalizeImageBytes(await response.arrayBuffer());
  if (bytes.length > maxBytes) referenceImageTooLarge(maxBytes);
  return bytes;
}

function normalizeReferenceMime(contentType) {
  const value = stringValue(contentType).split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg");
  if (!value) return "";
  if (!GENERATED_IMAGE_ALLOWED_MIME_TYPES.includes(value)) {
    referenceImageUnsupported("参考图 Content-Type 不是支持的图片格式。");
  }
  return value;
}

function referenceFetchTimeoutMs() {
  return intRange(process.env.REFERENCE_IMAGE_FETCH_TIMEOUT_SECONDS, 1, 120, DEFAULT_REFERENCE_FETCH_TIMEOUT_SECONDS) * 1000;
}

function referenceImageMaxBytes() {
  return intRange(process.env.REFERENCE_IMAGE_MAX_BYTES, 1, 200 * 1024 * 1024, DEFAULT_GENERATED_IMAGE_MAX_BYTES);
}

function referenceImageNotAccessible() {
  throw new ImageApiError({
    statusCode: 400,
    status: "failed",
    errorCode: "REFERENCE_IMAGE_NOT_ACCESSIBLE",
    message: "参考图地址无法被生图服务访问。"
  });
}

function referenceImageTooLarge(maxBytes) {
  throw new ImageApiError({
    statusCode: 400,
    status: "failed",
    errorCode: "REFERENCE_IMAGE_TOO_LARGE",
    message: `参考图超过 ${maxBytes} 字节大小限制。`
  });
}

function referenceImageUnsupported(message) {
  throw new ImageApiError({
    statusCode: 400,
    status: "failed",
    errorCode: "REFERENCE_IMAGE_UNSUPPORTED",
    message
  });
}

function safeReferenceFilename(url) {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop() || "reference.png";
    return name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "reference.png";
  } catch {
    return "reference.png";
  }
}

export function longRunningSubmitConfig(config = defaultProviderConfig()) {
  return {
    ...config,
    requestTimeoutSeconds: Math.max(
      Number(config.requestTimeoutSeconds) || 0,
      LONG_RUNNING_SUBMIT_MIN_TIMEOUT_SECONDS
    ),
    retryAttempts: 1
  };
}

export async function fetchUpstream(kind, initFactory, fetchImpl = globalThis.fetch, config = defaultProviderConfig()) {
  const url = resolveAuthorizedFetchUrl(kind, config);
  let lastError = null;
  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    try {
      const credential = nextImageApiCredential(config);
      if (!credential) providerConfigMissing();
      const init = typeof initFactory === "function" ? initFactory(credential) : initFactory;
      return await fetchUpstreamOnce(url, init, fetchImpl, config);
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
    const url = resolveAuthorizedFetchUrl(kind, config);
    const response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal
    });
    const contentType = stringValue(response.headers?.get?.("content-type")).trim().toLowerCase();
    if (/^image\/(png|jpeg|jpg|webp)(?:;|$)/i.test(contentType)) {
      if (!response.ok) {
        throw upstreamHttpError(response, {}, "", kind);
      }
      const bytes = await readUpstreamResponseBytes(response);
      return {
        data: [{
          binary: bytes,
          mime_type: contentType.split(";")[0].replace("image/jpg", "image/jpeg")
        }]
      };
    }
    const text = await readUpstreamResponseText(response);
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
    if (error && error.name === "AbortError") {
      throw new ImageApiError({
        statusCode: 504,
        status: "failed",
        errorCode: "IMAGE_PROVIDER_TIMEOUT",
        message: "图片生成超时，请稍后重试。",
        details: {
          backend_call_summary: {
            stage: "provider_submit",
            endpoint_kind: providerEndpointKind(kind),
            provider_error_code: "request_timeout",
            retryable: true
          }
        }
      });
    }
    if (error instanceof ImageApiError) throw error;
    if (String(error?.message || "").toLowerCase() === "terminated") {
      throw upstreamSyntheticError(502, "upstream_terminated", "上游图片生成连接提前中断。", kind);
    }
    if (String(error?.message || "").toLowerCase() === "fetch failed") {
      throw upstreamSyntheticError(502, "upstream_unreachable", "上游图片生成连接失败。", kind);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readUpstreamResponseText(response) {
  if (response?.body && typeof response.body.getReader === "function") {
    const bytes = await readUpstreamResponseBytes(response, { recoverAs: "json" });
    return bytes.toString("utf8");
  }
  if (typeof response?.text === "function") return response.text();
  return "";
}

async function readUpstreamResponseBytes(response, { recoverAs = "image" } = {}) {
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = normalizeImageBytes(value);
        total += chunk.length;
        chunks.push(chunk);
      }
    } catch (error) {
      const buffered = Buffer.concat(chunks, total);
      if (isRecoverableCompletePayload(buffered, recoverAs)) return buffered;
      throw error;
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total);
  }
  if (typeof response?.arrayBuffer === "function") return normalizeImageBytes(await response.arrayBuffer());
  return Buffer.alloc(0);
}

function isRecoverableCompletePayload(bytes, recoverAs) {
  if (!bytes.length) return false;
  if (recoverAs === "image") return Boolean(detectImageMime(bytes));
  if (recoverAs === "json") {
    try {
      JSON.parse(bytes.toString("utf8"));
      return true;
    } catch {
      return false;
    }
  }
  return false;
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
  return resolveConfiguredUpstreamUrl(kind, config);
}

export function resolveAuthorizedFetchUrl(kind, config = defaultProviderConfig()) {
  const value = stringValue(kind).trim() || config.baseUrl;
  try {
    return resolveConfiguredUpstreamUrl(value, config);
  } catch (error) {
    if (isConfiguredEndpointCandidate(value, config)) throw error;
    return resolveAuthorizedUpstreamUrl(value, config);
  }
}

export function resolveConfiguredUpstreamUrl(kind, config = defaultProviderConfig()) {
  const value = stringValue(kind).trim() || config.baseUrl;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw unsafeProviderEndpointUrl();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw unsafeProviderEndpointUrl();
  if (parsed.username || parsed.password) throw unsafeProviderEndpointUrl();
  parsed.hash = "";

  const normalized = parsed.toString();
  const approved = new Set([config.baseUrl, config.imageEditUrl].map((item) => stripUrlHash(item)).filter(Boolean));
  if (!approved.has(normalized)) throw unsafeProviderEndpointUrl();
  return normalized;
}

function isConfiguredEndpointCandidate(value, config = defaultProviderConfig()) {
  let parsed;
  try {
    parsed = new URL(stringValue(value).trim() || config.baseUrl);
  } catch {
    return false;
  }
  parsed.hash = "";
  const normalized = parsed.toString();
  return normalized === stripUrlHash(config.baseUrl) || normalized === stripUrlHash(config.imageEditUrl);
}

export function resolveAuthorizedUpstreamUrl(kind, config = defaultProviderConfig()) {
  const value = stringValue(kind).trim();
  if (!value) return config.baseUrl;
  if (/\s/.test(value)) throw unsafeProviderPollUrl();
  if (/^\/\//.test(value)) throw unsafeProviderPollUrl();
  if (/^https?:\/\//i.test(value)) return normalizeAuthorizedProviderUrl(value, config);
  try {
    return normalizeAuthorizedProviderUrl(new URL(value, providerRelativeBase(value, config)).toString(), config);
  } catch (error) {
    if (error instanceof ImageApiError) throw error;
    throw unsafeProviderPollUrl();
  }
}

export function extractImageUrls(json, format = "png") {
  return normalizeProviderImages(json, format);
}

export async function normalizeProviderResult(json, format = "png", fetchImpl = globalThis.fetch, config = defaultProviderConfig()) {
  try {
    const immediate = extractImageUrlsAllowEmpty(json, format);
    if (immediate.status === "ok") return immediate.images;
    if (immediate.status === "unsupported") providerUnsupported();

    const asyncHandle = findAsyncHandle(json);
    if (!asyncHandle) extractImageUrls(json, format);
    return pollProviderResult(asyncHandle, format, fetchImpl, config);
  } catch (error) {
    throw withBackendCallSummary(error, {
      stage: "provider_normalize",
      endpoint_kind: "unknown",
      provider_error_code: error instanceof ImageApiError ? error.errorCode : "provider_normalize_failed",
      retryable: false
    });
  }
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
  if (statusUrl) return { statusUrl, id };
  if (id) return { id };
  return null;
}

async function pollProviderResult(handle, format, fetchImpl, config = defaultProviderConfig()) {
  const deadline = Date.now() + config.pollTimeoutSeconds * 1000;
  const intervalMs = Math.max(1000, config.pollIntervalSeconds * 1000);
  while (Date.now() < deadline) {
    const endpoint = resolveProviderPollEndpoint(handle, config);
    if (!endpoint) break;
    await sleep(intervalMs);
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
  throw new ImageApiError({
    statusCode: 504,
    status: "failed",
    errorCode: "IMAGE_PROVIDER_TIMEOUT",
    message: "图片生成超时，请稍后重试。",
    details: {
      backend_call_summary: {
        stage: "provider_poll",
        endpoint_kind: "poll",
        provider_error_code: "poll_timeout",
        retryable: true
      }
    }
  });
}

function resolveProviderPollEndpoint(handle, config) {
  const candidate = handle.statusUrl || buildPollUrl(config, handle.id);
  if (!candidate) return "";
  return resolveAuthorizedUpstreamUrl(candidate, config);
}

function buildPollUrl(config, id) {
  if (!id || !config.pollBaseUrl) return "";
  return `${config.pollBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(id)}`;
}

function providerRelativeBase(value, config = defaultProviderConfig()) {
  if (value.startsWith("/") || /^v1\//i.test(value)) return `${providerOrigin(config.baseUrl)}/`;
  const preferred = stringValue(config.pollBaseUrl).trim();
  if (preferred) return preferred.endsWith("/") ? preferred : `${preferred}/`;
  return `${providerOrigin(config.baseUrl)}/`;
}

export function normalizeAuthorizedProviderUrl(value, config = defaultProviderConfig()) {
  let parsed;
  try {
    parsed = new URL(stringValue(value).trim());
  } catch {
    throw unsafeProviderPollUrl();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw unsafeProviderPollUrl();
  if (parsed.username || parsed.password) throw unsafeProviderPollUrl();
  if (isUnsafeNetworkHost(parsed.hostname)) throw unsafeProviderPollUrl();
  if (!isApprovedProviderUrl(parsed, config)) throw unsafeProviderPollUrl();
  if (!parsed.pathname.startsWith("/v1/")) throw unsafeProviderPollUrl();
  parsed.hash = "";
  return parsed.toString();
}

function isApprovedProviderUrl(parsed, config) {
  const approvedOrigins = approvedProviderOrigins(config);
  return approvedOrigins.has(providerOrigin(parsed.toString()));
}

function approvedProviderOrigins(config = defaultProviderConfig()) {
  const origins = new Set();
  for (const endpoint of [config.baseUrl, config.imageEditUrl, config.pollBaseUrl]) {
    const origin = providerOrigin(endpoint);
    if (origin) origins.add(origin);
  }
  return origins;
}

function providerOrigin(value) {
  try {
    const parsed = new URL(stringValue(value).trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function stripUrlHash(value) {
  try {
    const parsed = new URL(stringValue(value).trim());
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function defaultProviderConfig() {
  const fileConfig = loadAiTuRuntimeConfig();
  const envKeys = parseApiKeys(process.env.IMAGE_API_KEYS, process.env.IMAGE_API_KEY);
  const fileKeys = parseApiKeys(fileConfig.apiKeys, fileConfig.apiKey);
  const keys = envKeys.length ? envKeys : fileKeys;
  const imageTransport = stringValue(process.env.IMAGE_TRANSPORT).trim() || stringValue(fileConfig.imageTransport).trim();
  const baseUrl = generationsEndpointFor(
    stringValue(process.env.IMAGE_API_BASE).trim()
    || stringValue(fileConfig.baseUrl).trim()
    || AI_TU_DEFAULT_GENERATIONS_URL
  );
  const imageEditUrl = stringValue(process.env.IMAGE_EDIT_BASE).trim() || stringValue(fileConfig.imageEditUrl).trim() || editsEndpointFor(baseUrl);
  return sanitizeProviderConfig({
    baseUrl,
    imageEditUrl,
    imageTransport,
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
    resolve("ai-tu/runtime-config.json"),
    resolve("ai-tu/runtime-config.example.json")
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
  const baseUrl = normalizeGenerationsEndpoint(value.baseUrl || AI_TU_DEFAULT_GENERATIONS_URL);
  const imageTransport = value.imageTransport === "url" ? "url" : "edit";
  const imageEditUrl = normalizeEditsEndpoint(value.imageEditUrl || editsEndpointFor(baseUrl));
  assertNotSelfRecursiveProviderEndpoint(baseUrl);
  assertNotSelfRecursiveProviderEndpoint(imageEditUrl);
  const keyMode = value.keyMode === "multi" ? "multi" : "single";
  const apiKeys = parseApiKeys(value.apiKeys, value.apiKey);
  const singleKey = stringValue(value.apiKey).trim() || apiKeys[0] || "";
  const pollBaseUrl = normalizePollBaseEndpoint(value.pollBaseUrl || baseUrl);
  return {
    baseUrl,
    imageEditUrl,
    model: FIXED_IMAGE_MODEL,
    imageModel: FIXED_IMAGE_MODEL,
    imageTransport,
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

export function normalizeGenerationsEndpoint(value) {
  const endpoint = normalizeEndpoint(value);
  if (!/\/v1\/images\/generations$/i.test(endpoint)) {
    throw new ImageApiError({
      statusCode: 400,
      status: "failed",
      errorCode: "INVALID_REQUEST_SCHEMA",
      message: "Provider text-to-image endpoint 必须以 /v1/images/generations 结尾。"
    });
  }
  return endpoint;
}

export function normalizeEditsEndpoint(value) {
  return normalizeEndpoint(value);
}

export function normalizePollBaseEndpoint(value) {
  const endpoint = normalizeEndpoint(value);
  const parsed = new URL(endpoint);
  if (isUnsafeNetworkHost(parsed.hostname) || !parsed.pathname.startsWith("/v1/")) {
    throw unsafeProviderPollUrl();
  }
  return endpoint;
}

function editsEndpointFor(baseUrl) {
  const endpoint = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (/\/v1\/images\/generations$/i.test(endpoint)) {
    return endpoint.replace(/\/v1\/images\/generations$/i, "/v1/images/edits");
  }
  return AI_TU_DEFAULT_EDITS_URL;
}

function generationsEndpointFor(baseUrl) {
  const endpoint = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!endpoint) return AI_TU_DEFAULT_GENERATIONS_URL;
  if (/\/v1\/images\/generations$/i.test(endpoint)) return endpoint;
  if (/\/v1\/images\/edits$/i.test(endpoint)) {
    return endpoint.replace(/\/v1\/images\/edits$/i, "/v1/images/generations");
  }
  return normalizeEndpoint(endpoint) + "/v1/images/generations";
}

export function activeKeys(config = defaultProviderConfig()) {
  if (config.keyMode === "multi") return parseApiKeys(config.apiKeys, "");
  return config.apiKey ? [config.apiKey] : [];
}

export function hasRequiredProviderConfig(config = defaultProviderConfig()) {
  return Boolean(config.baseUrl && config.imageEditUrl && config.model === FIXED_IMAGE_MODEL && config.imageModel === FIXED_IMAGE_MODEL && activeKeys(config).length);
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
  error.providerErrorCode = upstreamProviderErrorCode(json) || "upstream_failed";
  error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  return error;
}

function upstreamSyntheticError(status, code, message, kind = "") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.upstreamEndpoint = kind;
  error.providerErrorCode = code;
  return error;
}

function mapProviderError(error) {
  if (error instanceof ImageApiError) return error;
  if (error?.status === 504) {
    return new ImageApiError({
      statusCode: 504,
      status: "failed",
      errorCode: "IMAGE_PROVIDER_TIMEOUT",
      message: "图片生成超时，请稍后重试。",
      details: { backend_call_summary: redactedBackendCallSummary(error) }
    });
  }
  return new ImageApiError({
    statusCode: error?.status && error.status >= 400 ? 502 : 500,
    status: "failed",
    errorCode: "IMAGE_PROVIDER_CALL_FAILED",
    message: "图片生成 provider 调用失败。",
    details: { backend_call_summary: redactedBackendCallSummary(error) }
  });
}

function redactedBackendCallSummary(error) {
  const upstreamStatus = Number(error?.status);
  const retryAfterMs = Number(error?.retryAfterMs);
  const endpointKind = providerEndpointKind(error?.upstreamEndpoint);
  const summary = {
    stage: endpointKind === "poll" ? "provider_poll" : "provider_submit",
    endpoint_kind: endpointKind,
    provider_error_code: safeProviderErrorCode(error?.providerErrorCode || error?.code),
    retryable: isRetryableUpstreamError(error)
  };
  if (Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599) {
    summary.upstream_status = upstreamStatus;
  }
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    summary.retry_after_ms = Math.min(3_600_000, Math.floor(retryAfterMs));
  }
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== "" && value != null));
}

function withBackendCallSummary(error, summary) {
  if (!(error instanceof ImageApiError)) return error;
  const existing = error.details && typeof error.details === "object" && !Array.isArray(error.details)
    ? error.details.backend_call_summary
    : null;
  if (existing && typeof existing === "object") return error;
  return new ImageApiError({
    statusCode: error.statusCode,
    status: error.status,
    errorCode: error.errorCode,
    message: error.message,
    details: { backend_call_summary: summary }
  });
}

function providerEndpointKind(value) {
  const text = stringValue(value).toLowerCase();
  if (text.endsWith("/v1/images/generations") || text === "generations") return "generations";
  if (text.endsWith("/v1/images/edits") || text === "edits") return "edits";
  if (text) return "poll";
  return "unknown";
}

function safeProviderErrorCode(value) {
  const text = stringValue(value).trim();
  if (!text || text.length > 80) return "";
  if (!/^[a-zA-Z0-9_.:-]+$/.test(text)) return "";
  if (/https?:|bearer|token|secret|key|base64|data:image/i.test(text)) return "";
  return text;
}

function unsafeProviderPollUrl() {
  throw new ImageApiError({
    statusCode: 502,
    status: "failed",
    errorCode: "PROVIDER_POLL_URL_UNSAFE",
    message: "provider poll url 不在授权上游范围内。"
  });
}

function unsafeProviderEndpointUrl() {
  throw new ImageApiError({
    statusCode: 502,
    status: "failed",
    errorCode: "PROVIDER_ENDPOINT_UNSAFE",
    message: "provider endpoint 不在授权上游范围内。"
  });
}

function assertNotSelfRecursiveProviderEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(stringValue(value).trim());
  } catch {
    return;
  }
  const currentPort = String(process.env.PORT || 8787);
  const parsedPort = parsed.port || (parsed.protocol === "http:" ? "80" : "443");
  if (parsedPort !== currentPort) return;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const configuredHost = stringValue(process.env.HOST || "127.0.0.1").toLowerCase();
  const selfHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (configuredHost && configuredHost !== "0.0.0.0" && configuredHost !== "::") selfHosts.add(configuredHost.replace(/^\[|\]$/g, ""));
  if (!selfHosts.has(host)) return;
  throw new ImageApiError({
    statusCode: 502,
    status: "failed",
    errorCode: "PROVIDER_ENDPOINT_UNSAFE",
    message: "provider endpoint 不能指向当前图片服务自身，避免递归调用。"
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

function upstreamProviderErrorCode(json) {
  const candidates = [
    json?.error?.code,
    json?.error?.type,
    json?.code,
    json?.type,
    json?.status
  ];
  for (const candidate of candidates) {
    const safe = safeProviderErrorCode(candidate);
    if (safe) return safe;
  }
  return "";
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
