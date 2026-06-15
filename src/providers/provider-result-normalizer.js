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
    assertNoProviderError(json);
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
    let image = null;
    try {
      image = normalizeProviderImageObject(item, format);
    } catch (error) {
      return;
    }
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
    return generatedImageFromBinary(item, {
      mime: formatToMime(fallbackFormat),
      format: fallbackFormat,
      width: null,
      height: null
    });
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

  const encoded = encodedImageValue(item);
  if (encoded) {
    return generatedImageFromEncoded(encoded, {
      mime: imageMime(item, fallbackFormat),
      format: stringValue(item.format || fallbackFormat).trim() || fallbackFormat,
      width: finiteNumber(item.width),
      height: finiteNumber(item.height)
    });
  }

  const binary = binaryImageValue(item);
  if (binary) {
    return generatedImageFromBinary(binary, {
      mime: imageMime(item, fallbackFormat),
      format: stringValue(item.format || fallbackFormat).trim() || fallbackFormat,
      width: finiteNumber(item.width),
      height: finiteNumber(item.height)
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
    return generatedImageFromEncoded(text, {
      mime: formatToMime(fallbackFormat),
      format: fallbackFormat,
      width: null,
      height: null
    });
  }
  return null;
}

function isProviderImageCandidate(node) {
  return Boolean(providerUrlValue(node) || binaryImageValue(node) || encodedImageValue(node));
}

function providerUrlValue(item) {
  return [item.url, item.image_url, item.output_url, item.download_url]
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
}

function assertNoProviderError(value) {
  let hasProviderError = false;
  walk(value, (node) => {
    if (hasProviderError || !node || typeof node !== "object") return;
    if (Buffer.isBuffer(node) || ArrayBuffer.isView(node) || node instanceof ArrayBuffer) return;
    if (Object.prototype.hasOwnProperty.call(node, "error") && node.error) {
      hasProviderError = true;
    }
  });
  if (hasProviderError) {
    throw new ImageApiError({
      statusCode: 502,
      status: "failed",
      errorCode: "IMAGE_PROVIDER_CALL_FAILED",
      message: "provider 返回错误。"
    });
  }
}

function assertNoForbiddenProviderPayload(value) {
  let forbidden = false;
  walk(value, (node) => {
    if (forbidden || node == null) return;
    if (Buffer.isBuffer(node) || node instanceof ArrayBuffer || ArrayBuffer.isView(node)) return;
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (providerUrlValue(node) && (encodedImageValue(node) || binaryImageValue(node) || hasNonArrayDataPayload(node))) {
      forbidden = true;
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (isForbiddenProviderPayloadField(key, child)) {
        forbidden = true;
        return;
      }
    }
  });
  if (forbidden) unsupportedProviderImage("上游返回的图片结果包含不允许透传的字段。");
}

function isForbiddenProviderPayloadField(key, value) {
  const normalized = String(key || "").toLowerCase();
  if (normalized === "data") return false;
  if (/^(?:bytes|buffer|binary)$/i.test(normalized)) return false;
  return /^(?:final_prompt|compiled_prompt|provider_raw|provider_raw_payload|provider_raw_response|raw|raw_provider_payload|raw_provider_response|raw_response|raw_payload)$/i.test(normalized);
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
    if (typeof value === "string" && (isDataImageUrl(value) || looksLikeBase64(value.replace(/\s+/g, "")))) return value;
  }
  return "";
}

function providerImageCandidateKey(item) {
  if (!item) return "";
  if (Buffer.isBuffer(item) || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return `binary:${hashBytes(item)}`;
  if (typeof item === "string") {
    if (/^https?:\/\//i.test(item)) return `text:${item}`;
    if (isDataImageUrl(item)) return `encoded:${hashText(item)}`;
    return "";
  }
  if (typeof item !== "object") return "";
  const url = providerUrlValue(item);
  if (url) return `url:${url}`;
  const binary = binaryImageValue(item);
  if (binary) return `binary:${hashBytes(binary)}`;
  const encoded = encodedImageValue(item);
  if (encoded) return `encoded:${hashText(encoded)}`;
  return "";
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

function normalizeImageFormat(format) {
  const value = stringValue(format).trim().toLowerCase();
  if (value === "jpg") return "jpeg";
  if (["png", "jpeg", "webp"].includes(value)) return value;
  const mimeFormat = mimeToFormat(value);
  return mimeFormat || "png";
}

function generatedImageFromEncoded(value, { mime = "", format = "", width = null, height = null } = {}) {
  const parsed = parseBase64Image(value, { mime, format });
  const stored = putGeneratedImage({
    bytes: parsed.bytes,
    mime: parsed.mime,
    format: parsed.format,
    maxBytes: DEFAULT_GENERATED_IMAGE_MAX_BYTES,
    source: "real_provider_response_base64"
  });
  return {
    image_id: stored.id,
    url: stored.path,
    width,
    height,
    format: stored.format,
    mime: stored.mime,
    size: stored.size,
    url_kind: "service_generated_image_url_from_real_provider_base64"
  };
}

function generatedImageFromBinary(value, { mime = "", format = "", width = null, height = null } = {}) {
  const stored = putGeneratedImage({
    bytes: value,
    mime,
    format,
    maxBytes: DEFAULT_GENERATED_IMAGE_MAX_BYTES,
    source: "real_provider_response_binary"
  });
  return {
    image_id: stored.id,
    url: stored.path,
    width,
    height,
    format: stored.format,
    mime: stored.mime,
    size: stored.size,
    url_kind: "service_generated_image_url_from_real_provider_binary"
  };
}

function parseBase64Image(value, { mime = "", format = "" } = {}) {
  const text = stringValue(value).trim();
  let encoded = text;
  let detectedMime = stringValue(mime).split(";")[0].trim().toLowerCase();
  if (isDataImageUrl(text)) {
    const match = text.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) unsupportedProviderImage("上游返回的 base64 图片格式非法。");
    detectedMime = match[1].toLowerCase();
    encoded = match[2];
  }
  const compact = normalizeBase64Text(encoded);
  if (!compact) unsupportedProviderImage("上游返回的 base64 图片格式非法。");
  return {
    bytes: Buffer.from(compact, "base64"),
    mime: detectedMime || formatToMime(format),
    format
  };
}

function looksLikeBase64(value) {
  return Boolean(normalizeBase64Text(value));
}

function normalizeBase64Text(value) {
  let text = stringValue(value).replace(/\s+/g, "");
  if (!text) return "";
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return "";
  const firstPadding = text.indexOf("=");
  if (firstPadding >= 0 && !/^=*$/.test(text.slice(firstPadding))) return "";
  text = text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const remainder = text.length % 4;
  if (remainder === 1) return "";
  if (remainder) text += "=".repeat(4 - remainder);
  return text;
}

function imageMime(item, fallbackFormat = "png") {
  return stringValue(item.mime_type || item.mime || item.content_type).trim() || formatToMime(item.format || fallbackFormat);
}

function hasNonArrayDataPayload(item) {
  return Object.prototype.hasOwnProperty.call(item, "data") && !Array.isArray(item.data);
}

function hashText(value) {
  return createHash("sha256").update(stringValue(value)).digest("hex");
}

function hashBytes(value) {
  return createHash("sha256").update(Buffer.from(value instanceof ArrayBuffer ? value : ArrayBuffer.isView(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value)).digest("hex");
}

function unsupportedProviderImage(message) {
  throw new ImageApiError({
    statusCode: 502,
    status: "failed",
    errorCode: "PROVIDER_RESPONSE_UNSUPPORTED",
    message
  });
}
