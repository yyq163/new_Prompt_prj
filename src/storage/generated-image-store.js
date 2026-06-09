import { randomBytes, randomUUID } from "node:crypto";

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_IMAGES = 64;
const generatedImages = new Map();

export function putGeneratedImage({ bytes, mime = "image/png", format = "png" } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
  if (!buffer.length) return null;
  cleanupGeneratedImages();
  while (generatedImages.size >= MAX_IMAGES) {
    const oldestKey = generatedImages.keys().next().value;
    if (!oldestKey) break;
    generatedImages.delete(oldestKey);
  }
  const id = makeImageId();
  generatedImages.set(id, {
    bytes: buffer,
    mime,
    format,
    expiresAt: Date.now() + DEFAULT_TTL_MS
  });
  return {
    id,
    path: `/api/v1/generated-images/${encodeURIComponent(id)}`
  };
}

export function getGeneratedImage(id) {
  cleanupGeneratedImages();
  const item = generatedImages.get(String(id || ""));
  if (!item) return null;
  return item;
}

function cleanupGeneratedImages() {
  const now = Date.now();
  for (const [id, item] of generatedImages.entries()) {
    if (!item || item.expiresAt <= now) generatedImages.delete(id);
  }
}

function makeImageId() {
  const suffix = typeof randomUUID === "function"
    ? randomUUID().replaceAll("-", "")
    : randomBytes(16).toString("hex");
  return `img_${suffix.slice(0, 24)}`;
}
