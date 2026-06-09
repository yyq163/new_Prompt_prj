import { createHash } from "node:crypto";
import { ImageApiError } from "../core/errors.js";
import {
  DEFAULT_GENERATED_IMAGE_MAX_BYTES,
  formatToMime,
  mimeToFormat,
  putGeneratedImage
} from "../core/generated-image-store.js";
import { stringValue, walk } from "../core/runtime.js";

export function normalizeProviderImages(json, format = "png") {
  const found = [];
  const seen = new Set();

  pushImage(json);

  if (Array.isArray(json && json.data)) {
    json.data.forEach((item) => pushImage(item));
  }

  if (Array.isArray(json && json.output)) {
    json.output.forEach((item) => {
      if (item && item.type === "image_generation_call" && item.result) {
        pushImage({ b64_json: item.result, format });
      }
      if (Array.isArray(item && item.content)) item.content.forEach(pushImage);
    });
  }

  walk(json, (node) => {
    if (!node || typeof node !== "object" || Buffer.isBuffer(node) || ArrayBuffer.isView(node) || node instanceof ArrayBuffer) return;
    if (isProviderImageCandidate(node)) pushImage(node);
    if (Array.isArray(node.images)) node.images.forEach(pushImage);
  });

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
    const candidateKey = providerImageCandidateKey(item);
    if (candidateKey && seen.has(candidateKey)) return;
    const image = normalizeProviderImageObject(item, format);
    if (!image) return;
    const key = candidateKey || image.url || `${image.image_id || ""}:${image.size || ""}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(image);
  }
}

export function normalizeProviderImageObject(item, fallbackFormat = "png") {
  if (!item) return null;
  if (Buffer.isBuffer(item) || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
    return generatedImageFromBytes(item, { format: fallbackFormat });
  }
  if (typeof item === "string") {
    return normalizeProviderImageString(item, { fallbackFormat });
  }
  if (typeof item !== "object") return null;

  const url = providerUrlValue(item);
  if (url) {
    return {
      image_id: stringValue(item.image_id || item.id).trim() || "",
      url,
      width: finiteNumber(item.width),
      height: finiteNumber(item.height),
      format: normalizeImageFormat(stringValue(item.format).trim() || inferFormat(url) || fallbackFormat),
      url_kind: "provider_returned_url"
    };
  }

  const binary = binaryImageValue(item);
  if (binary) {
    return generatedImageFromBytes(binary, {
      mime: imageMime(item, fallbackFormat),
      format: stringValue(item.format).trim() || fallbackFormat,
      width: item.width,
      height: item.height
    });
  }

  const encoded = encodedImageValue(item);
  if (encoded) {
    return generatedImageFromEncoded(encoded, {
      mime: imageMime(item, fallbackFormat),
      format: stringValue(item.format).trim() || fallbackFormat,
      width: item.width,
      height: item.height
    });
  }

  return null;
}

function normalizeProviderImageString(value, { fallbackFormat = "png" } = {}) {
  const text = stringValue(value).trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    return {
      image_id: "",
      url: text,
      width: null,
      height: null,
      format: normalizeImageFormat(inferFormat(text) || fallbackFormat),
      url_kind: "provider_returned_url"
    };
  }
  if (isDataImageUrl(text)) {
    return generatedImageFromEncoded(text, { format: fallbackFormat });
  }
  return null;
}

function generatedImageFromEncoded(value, { mime = "", format = "png", width = null, height = null } = {}) {
  const parsed = parseBase64Image(value);
  if (!parsed) unsupportedProviderImage("上游返回的 base64 图片格式非法。");
  return generatedImageFromBytes(parsed.bytes, {
    mime: parsed.mime || mime || formatToMime(format),
    format,
    width,
    height
  });
}

function generatedImageFromBytes(bytes, { mime = "", format = "png", width = null, height = null } = {}) {
  const stored = putGeneratedImage({
    bytes,
    mime: mime || formatToMime(format),
    format,
    maxBytes: DEFAULT_GENERATED_IMAGE_MAX_BYTES,
    source: "real_provider_response"
  });
  return {
    image_id: stored.id,
    url: stored.path,
    width: finiteNumber(width),
    height: finiteNumber(height),
    format: stored.format || normalizeImageFormat(format),
    mime: stored.mime,
    size: stored.size,
    url_kind: "service_generated_image_url_from_real_provider_bytes"
  };
}

function parseBase64Image(value) {
  const text = stringValue(value).trim();
  if (!text) return null;
  const dataUrl = text.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  const mime = dataUrl ? dataUrl[1].toLowerCase() : "";
  const payload = dataUrl ? dataUrl[2] : text;
  const base64 = payload.replace(/\s+/g, "");
  if (!looksLikeBase64(base64)) return null;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) return null;
  return { bytes, mime };
}

function isProviderImageCandidate(node) {
  return Boolean(providerUrlValue(node) || binaryImageValue(node) || encodedImageValue(node));
}

function providerUrlValue(item) {
  return [item.url, item.image_url, item.output_url, item.download_url]
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
}

function binaryImageValue(item) {
  for (const key of ["bytes", "buffer", "binary", "data"]) {
    const value = item[key];
    if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  }
  return null;
}

function encodedImageValue(item) {
  for (const key of ["b64_json", "base64", "image_base64", "data_url"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  for (const key of ["image", "result"]) {
    const value = item[key];
    if (typeof value === "string" && isDataImageUrl(value)) return value;
  }
  return "";
}

function providerImageCandidateKey(item) {
  if (!item) return "";
  if (Buffer.isBuffer(item) || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
    return `bytes:${hashBytes(Buffer.from(item))}`;
  }
  if (typeof item === "string") return `text:${hashText(item)}`;
  if (typeof item !== "object") return "";
  const url = providerUrlValue(item);
  if (url) return `url:${url}`;
  const binary = binaryImageValue(item);
  if (binary) return `bytes:${hashBytes(Buffer.from(binary))}`;
  const encoded = encodedImageValue(item);
  if (encoded) return `encoded:${hashText(encoded.replace(/\s+/g, ""))}`;
  return "";
}

function imageMime(item, fallbackFormat = "png") {
  const explicit = stringValue(item.mime || item.mimetype || item.mime_type || item.content_type || item.type).trim();
  if (/^image\//i.test(explicit)) return explicit;
  const format = stringValue(item.format || fallbackFormat || "png").trim().toLowerCase();
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inferFormat(url) {
  const clean = String(url || "").split("?")[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  if (!match) return "";
  if (["png", "jpg", "jpeg", "webp"].includes(match[1])) return match[1] === "jpg" ? "jpeg" : match[1];
  return "";
}

function isDataImageUrl(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(stringValue(value).trim());
}

function looksLikeBase64(value) {
  if (!value || value.length < 8 || value.length % 4 === 1) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeImageFormat(format) {
  const value = stringValue(format).trim().toLowerCase();
  if (value === "jpg") return "jpeg";
  if (["png", "jpeg", "webp"].includes(value)) return value;
  const mimeFormat = mimeToFormat(value);
  return mimeFormat || "png";
}

function hashText(value) {
  return createHash("sha256").update(stringValue(value)).digest("hex");
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function unsupportedProviderImage(message) {
  throw new ImageApiError({
    statusCode: 502,
    status: "failed",
    errorCode: "PROVIDER_RESPONSE_UNSUPPORTED",
    message
  });
}
