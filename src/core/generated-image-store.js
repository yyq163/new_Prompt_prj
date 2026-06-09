import { randomBytes, randomUUID } from "node:crypto";
import { ImageApiError } from "./errors.js";
import { intRange, stringValue } from "./runtime.js";

export const GENERATED_IMAGE_ALLOWED_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

export const DEFAULT_GENERATED_IMAGE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_GENERATED_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_IMAGES = 64;
const generatedImages = new Map();

export function putGeneratedImage({
  bytes,
  mime = "",
  format = "",
  ttlMs = configuredTtlMs(),
  maxBytes = configuredMaxBytes(),
  source = "real_provider_response"
} = {}) {
  const buffer = normalizeImageBytes(bytes);
  if (!buffer.length) unsupportedGeneratedImage("上游返回的图片为空。");
  const maxSize = intRange(maxBytes, 1, 200 * 1024 * 1024, DEFAULT_GENERATED_IMAGE_MAX_BYTES);
  if (buffer.length > maxSize) unsupportedGeneratedImage("上游返回的图片超过大小限制。");

  const normalizedMime = normalizeGeneratedImageMime(mime, format, buffer);
  cleanupGeneratedImages();
  trimGeneratedImages(configuredMaxCount());

  const id = makeImageId();
  const expiresAt = Date.now() + intRange(ttlMs, 1000, 24 * 60 * 60 * 1000, DEFAULT_GENERATED_IMAGE_TTL_MS);
  const record = {
    id,
    bytes: buffer,
    mime: normalizedMime,
    format: mimeToFormat(normalizedMime),
    size: buffer.length,
    createdAt: Date.now(),
    expiresAt,
    source: stringValue(source).trim() || "real_provider_response"
  };
  generatedImages.set(id, record);
  return {
    id,
    image_id: id,
    path: `/api/v1/generated-images/${encodeURIComponent(id)}`,
    mime: record.mime,
    format: record.format,
    size: record.size,
    expiresAt
  };
}

export function getGeneratedImage(id) {
  cleanupGeneratedImages();
  const key = stringValue(id).trim();
  if (!key) return null;
  const item = generatedImages.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    if (item) generatedImages.delete(key);
    return null;
  }
  return item;
}

export function deleteGeneratedImage(id) {
  return generatedImages.delete(stringValue(id).trim());
}

export function cleanupGeneratedImages(now = Date.now()) {
  for (const [id, item] of generatedImages.entries()) {
    if (!item || item.expiresAt <= now) generatedImages.delete(id);
  }
}

export function normalizeGeneratedImageMime(mime = "", format = "", bytes = null) {
  const detected = detectImageMime(bytes);
  const explicit = stringValue(mime).split(";")[0].trim().toLowerCase();
  const fromFormat = formatToMime(format);
  if (!detected) {
    unsupportedGeneratedImage("上游返回的图片字节不是支持的图片格式。");
  }
  const claimed = explicit || fromFormat;
  if (claimed && GENERATED_IMAGE_ALLOWED_MIME_TYPES.includes(claimed) && claimed !== detected) {
    unsupportedGeneratedImage("上游返回的图片 MIME 类型与图片字节不匹配。");
  }
  const normalized = detected;
  if (!GENERATED_IMAGE_ALLOWED_MIME_TYPES.includes(normalized)) {
    unsupportedGeneratedImage("上游返回的图片 MIME 类型不支持。");
  }
  return normalized;
}

export function detectImageMime(bytes) {
  const buffer = normalizeImageBytes(bytes);
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

export function normalizeImageBytes(bytes) {
  if (!bytes) return Buffer.alloc(0);
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Buffer.from(bytes);
  return Buffer.from(bytes);
}

export function formatToMime(format = "") {
  const value = stringValue(format).trim().toLowerCase().replace(/^\./, "");
  if (value === "png") return "image/png";
  if (value === "jpg" || value === "jpeg") return "image/jpeg";
  if (value === "webp") return "image/webp";
  return "";
}

export function mimeToFormat(mime = "") {
  const value = stringValue(mime).split(";")[0].trim().toLowerCase();
  if (value === "image/png") return "png";
  if (value === "image/jpeg") return "jpeg";
  if (value === "image/webp") return "webp";
  return "";
}

export function clearGeneratedImagesForTest() {
  generatedImages.clear();
}

function trimGeneratedImages(maxCount = configuredMaxCount()) {
  while (generatedImages.size >= maxCount) {
    const oldestKey = generatedImages.keys().next().value;
    if (!oldestKey) break;
    generatedImages.delete(oldestKey);
  }
}

function configuredTtlMs() {
  return intRange(process.env.GENERATED_IMAGE_TTL_MS, 1000, 24 * 60 * 60 * 1000, DEFAULT_GENERATED_IMAGE_TTL_MS);
}

function configuredMaxBytes() {
  return intRange(process.env.GENERATED_IMAGE_MAX_BYTES, 1, 200 * 1024 * 1024, DEFAULT_GENERATED_IMAGE_MAX_BYTES);
}

function configuredMaxCount() {
  return intRange(process.env.GENERATED_IMAGE_MAX_COUNT, 1, 10_000, DEFAULT_MAX_IMAGES);
}

function makeImageId() {
  const suffix = typeof randomUUID === "function"
    ? randomUUID().replaceAll("-", "")
    : randomBytes(18).toString("hex");
  return `img_${suffix.slice(0, 32)}`;
}

function unsupportedGeneratedImage(message) {
  throw new ImageApiError({
    statusCode: 502,
    status: "failed",
    errorCode: "PROVIDER_RESPONSE_UNSUPPORTED",
    message
  });
}
