import { getGeneratedImage } from "./generated-image-store.js";

export function generatedImageHttpResponse(imageId) {
  const image = getGeneratedImage(imageId);
  if (!image) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: Buffer.from(JSON.stringify({
        status: "failed",
        error_code: "IMAGE_NOT_FOUND",
        message: "图片不存在或已过期。"
      }))
    };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": image.mime || "image/png",
      "Content-Length": String(image.bytes.length),
      "Cache-Control": "no-store"
    },
    body: image.bytes
  };
}
