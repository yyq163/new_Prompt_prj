import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { handleImageGeneration } from "../../src/routes/image-generations.js";
import { clearGeneratedImagesForTest } from "../../src/core/generated-image-store.js";
import { generatedImageHttpResponse } from "../../src/core/generated-image-response.js";
import { extractImageUrls } from "../../src/providers/ai-tu-provider-adapter.js";

const ROOT = resolve(import.meta.dirname, "../..");
const EVIDENCE_ROOT = resolve(ROOT, "evidence");

const forbiddenPatterns = [
  /\bfinal_prompt\b/i,
  /\bfinal_prompt_preview\b/i,
  /\bcompiled_prompt\b/i,
  /\binternal_prompt\b/i,
  /\bragflow[_ -]?state\b/i,
  /\bfallback[_ -]?state\b/i,
  /\bprovider[_ -]?payload\b/i,
  /\bprovider_internal_payload\b/i,
  /\braw[_ -]?provider[_ -]?payload\b/i,
  /\bb64_json\b/i,
  /\bdata:image\b/i,
  /\bsecret\b/i,
  /\bapi[_ -]?key\b/i,
  /\btoken\b/i
];

const samplePng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89
]);

clearGeneratedImagesForTest();

const publicResult = await withEnv({
  PUBLIC_BASE_URL: "https://img.example.com/",
  RAGFLOW_ENHANCEMENT_URL: null
}, () => handleImageGeneration({
  task_type: "text_image",
  prompt: "生成一张山间晨雾图。",
  references: []
}, {
  provider: async () => ({
    status: "succeeded",
    images: [{
      image_id: "img_probe",
      url: "/api/v1/generated-images/img_probe",
      width: 1,
      height: 1,
      format: "png"
    }]
  })
}));

assert.equal(publicResult.statusCode, 200);
assert.equal(publicResult.payload.status, "succeeded");
assert.match(publicResult.payload.images[0].url, /^https:\/\/img\.example\.com\/api\/v1\/generated-images\//);
scanText("public-response", JSON.stringify(publicResult.payload));

clearGeneratedImagesForTest();
const bytesResult = await withEnv({
  PUBLIC_BASE_URL: "https://img.example.com/",
  RAGFLOW_ENHANCEMENT_URL: null
}, () => handleImageGeneration({
  task_type: "text_image",
  prompt: "生成一张山间晨雾图。",
  references: []
}, {
  provider: async () => ({
    status: "succeeded",
    images: extractImageUrls({ data: [{ b64_json: samplePng.toString("base64"), mime_type: "image/png" }] })
  })
}));
assert.equal(bytesResult.payload.images[0].url.includes("data:"), false);
assert.match(bytesResult.payload.images[0].url, /^https:\/\/img\.example\.com\/api\/v1\/generated-images\/img_/);
scanText("public-byte-response", JSON.stringify(bytesResult.payload));

let callbackFetches = 0;
const callbackResult = await handleImageGeneration({
  task_type: "text_image",
  prompt: "生成一张山间晨雾图。",
  references: [],
  callback_url: "https://example.com/callback"
}, {
  fetchImpl: async () => {
    callbackFetches += 1;
    throw new Error("callback must not run");
  },
  provider: async () => ({
    status: "succeeded",
    images: [{ image_id: "img_ok", url: "https://provider.example.com/ok.png", width: 1, height: 1, format: "png" }]
  })
});
assert.equal(callbackResult.statusCode, 200);
assert.equal(callbackFetches, 0);
assert.equal("callback_status" in callbackResult.payload, false);

for (const callback_url of [
  "http://127.0.0.1/cb",
  "http://localhost/cb",
  "http://10.0.0.1/cb",
  "http://172.16.0.1/cb",
  "http://192.168.0.1/cb",
  "http://169.254.0.1/cb",
  "http://[::1]/cb",
  "http://[fe80::1]/cb",
  "http://[fc00::1]/cb",
  "file:///tmp/cb",
  "data:text/plain,cb",
  "javascript:alert(1)"
]) {
  const rejected = await handleImageGeneration({
    task_type: "text_image",
    prompt: "生成一张山间晨雾图。",
    references: [],
    callback_url
  }, {
    provider: async () => {
      throw new Error("provider should not run after invalid callback");
    }
  });
  assert.equal(rejected.payload.status, "failed");
  assert.equal(rejected.payload.error_code, "INVALID_REQUEST_SCHEMA");
}

const stored = await import("../../src/core/generated-image-store.js");
const item = stored.putGeneratedImage({ bytes: samplePng, mime: "image/png", ttlMs: 60_000 });
const getResult = generatedImageHttpResponse(item.id);
assert.equal(getResult.statusCode, 200);
assert.equal(getResult.headers["Content-Type"], "image/png");
assert.equal(getResult.headers["Cache-Control"], "no-store");
assert.equal(getResult.headers["Content-Length"], String(samplePng.length));

for (const filePath of evidenceTextFiles(EVIDENCE_ROOT)) {
  scanText(relative(ROOT, filePath), readFileSync(filePath, "utf8"));
}

console.log("FINAL_V1_4_EVIDENCE_SCAN_PASS");

function scanText(label, text) {
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(text, pattern, `${label} contains forbidden pattern ${pattern}`);
  }
}

function evidenceTextFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name !== "screenshots") files.push(...evidenceTextFiles(path));
    } else if (/\.(json|md|txt)$/i.test(name)) {
      files.push(path);
    }
  }
  return files;
}

async function withEnv(values, fn) {
  const old = {};
  for (const [key, value] of Object.entries(values)) {
    old[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
