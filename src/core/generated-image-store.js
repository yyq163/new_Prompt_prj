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
  const normalized = detected;
  if (!GENERATED_IMAGE_ALLOWED_MIME_TYPES.includes(normalized)) {
    unsupportedGeneratedImage("上游返回的图片 MIME 类型不支持。");
  }
  return normalized;
}

export function detectImageMime(bytes) {
  const buffer = normalizeImageBytes(bytes);
  if (isValidPng(buffer)) {
    return "image/png";
  }
  if (isValidJpeg(buffer)) {
    return "image/jpeg";
  }
  if (isValidWebp(buffer)) {
    return "image/webp";
  }
  return "";
}

function isValidPng(buffer) {
  if (buffer.length < 45) return false;
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) return false;
  let offset = 8;
  let seenIhdr = false;
  let seenIdat = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (dataEnd > buffer.length || crcEnd > buffer.length) return false;
    const type = buffer.toString("ascii", typeStart, dataStart);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    if (crc32(buffer.subarray(typeStart, dataEnd)) !== expectedCrc) return false;

    if (!seenIhdr) {
      if (type !== "IHDR" || length !== 13) return false;
      seenIhdr = true;
    } else if (type === "IHDR") {
      return false;
    }
    if (type === "IDAT") seenIdat = true;
    if (type === "IEND") return length === 0 && seenIhdr && seenIdat && crcEnd === buffer.length;
    offset = crcEnd;
  }
  return false;
}

function isValidJpeg(buffer) {
  if (buffer.length < 4) return false;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) return false;

  let offset = 2;
  let seenSof = false;
  while (offset < buffer.length - 2) {
    while (offset < buffer.length - 2 && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length - 2) return false;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0x00) continue;
    if (marker === 0xd9) return false;
    if (marker === 0xda) {
      if (!seenSof || offset + 2 > buffer.length - 2) return false;
      const length = buffer.readUInt16BE(offset);
      const scanStart = offset + length;
      return length >= 2 && scanStart < buffer.length - 2;
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0x01) continue;
    if (offset + 2 > buffer.length - 2) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length - 2) return false;
    if (isJpegStartOfFrame(marker)) seenSof = true;
    offset += length;
  }
  return false;
}

function isValidWebp(buffer) {
  if (buffer.length < 20) return false;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return false;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return false;
  const riffSize = buffer.readUInt32LE(4);
  if (riffSize + 8 !== buffer.length) return false;
  let offset = 12;
  let seenVp8x = false;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) return false;
    if (chunk === "VP8X") {
      if (size !== 10) return false;
      seenVp8x = true;
    } else if (chunk === "VP8 ") {
      return size >= 10 && buffer[dataStart + 3] === 0x9d && buffer[dataStart + 4] === 0x01 && buffer[dataStart + 5] === 0x2a;
    } else if (chunk === "VP8L") {
      return size >= 5 && buffer[dataStart] === 0x2f;
    } else if (!seenVp8x && chunk === "ANIM") {
      return false;
    }
    offset = dataEnd + (size % 2);
  }
  return false;
}

function isJpegStartOfFrame(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

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
