import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const GATEWAY_ROOT = resolve(ROOT, "ai-tu/gateway");
const HTML_FILE = resolve(ROOT, "ai-tu/ai-image-generator.html");
const SERVER_FILE = resolve(ROOT, "ai-tu/gateway/server.js");
const FORBIDDEN_TOKENS = [
  "final_prompt",
  "compiled_prompt",
  "raw_provider_payload",
  "provider_payload",
  "provider_raw_response",
  "b64_json",
  "base64",
  "data:image",
  "Authorization",
  "Bearer",
  "secret-api-key",
  "token"
];
const FORBIDDEN_REQUEST_FIELDS = [
  "size",
  "output_format",
  "model",
  "mode",
  "resolution",
  "format",
  "final_prompt",
  "compiled_prompt",
  "raw_provider_payload",
  "provider_payload",
  "provider_raw_response",
  "b64_json",
  "base64"
];

test("ai-tu gateway POST /api/v1/image-generations calls prompt-image backend", async (t) => {
  const backendCalls = [];
  const backend = await startBackend(async (request, response, body) => {
    backendCalls.push({ request, body });
    sendJson(response, 200, {
      status: "succeeded",
      images: [{ url: "https://cdn.example.com/generated/text.png", width: 1024, height: 768, format: "png" }],
      warnings: [{ code: "SAFE_WARNING", message: "safe warning" }],
      final_prompt: "must-not-leak",
      compiled_prompt: "must-not-leak",
      provider_payload: { api_key: "secret-api-key" }
    });
  });
  t.after(backend.stop);

  const gateway = await startGateway({
    PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl,
    PROMPT_IMAGE_BACKEND_API_KEY: "secret-api-key"
  });
  t.after(gateway.stop);

  const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, textImageRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    status: "succeeded",
    images: [{ url: "https://cdn.example.com/generated/text.png", width: 1024, height: 768, format: "png" }],
    warnings: [{ code: "SAFE_WARNING", message: "safe warning" }]
  });
  assert.equal(backendCalls.length, 1);
  assert.equal(backendCalls[0].request.url, "/api/v1/image-generations");
  assert.equal(backendCalls[0].request.headers.authorization, "Bearer secret-api-key");
  assert.equal(backendCalls[0].body.task_type, "text_image");
  assert.deepEqual(backendCalls[0].body.references, []);
  assertV36BackendRequestWhitelist(backendCalls[0].body);
  assertNoForbiddenFields(response.body);
});

test("ai-tu gateway forwards only V3.6 whitelist fields to prompt-image backend", async (t) => {
  const backendCalls = [];
  const backend = await startBackend(async (request, response, body) => {
    backendCalls.push(body);
    sendJson(response, 200, {
      status: "succeeded",
      images: [{ url: "https://cdn.example.com/generated/whitelist.png", width: 1024, height: 768, format: "png" }],
      warnings: []
    });
  });
  t.after(backend.stop);

  const gateway = await startGateway({ PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl });
  t.after(gateway.stop);

  const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, {
    ...textImageRequest(),
    size: "2048x1152",
    output_format: "png",
    model: "gpt-image-2",
    mode: "text",
    resolution: "2048",
    format: "png",
    return_format: "png",
    final_prompt: "must-not-forward",
    compiled_prompt: "must-not-forward",
    raw_provider_payload: { token: "raw provider" },
    provider_payload: { token: "raw provider" },
    b64_json: sampleBase64(),
    base64: sampleBase64(),
    data_url: `data:image/png;base64,${sampleBase64()}`,
    api_key: "secret-api-key",
    token: "secret-token",
    output: {
      ...textImageRequest().output,
      format: "png",
      raw_provider_payload: { token: "raw provider" }
    },
    reference_policy: {
      unbound_entity: "block",
      token: "secret-token"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(backendCalls.length, 1);
  assert.deepEqual(backendCalls[0], {
    task_type: "text_image",
    prompt: "生成一张山间晨雾图。",
    references: [],
    reference_policy: {
      unbound_entity: "block"
    },
    output: {
      count: 1,
      aspect_ratio: "16:9",
      quality: "high",
      return_format: "url",
      language: "zh-CN"
    }
  });
  assertV36BackendRequestWhitelist(backendCalls[0]);
});

test("ai-tu gateway proxies legal http and https backend image URLs", async (t) => {
  const backend = await startBackend(async (request, response) => {
    sendJson(response, 200, {
      status: "succeeded",
      images: [
        { url: "https://cdn.example.com/generated/https.png", width: 1024, height: 768, format: "png" },
        { url: "http://cdn.example.com/generated/http.png", width: 512, height: 512, format: "png" }
      ],
      warnings: []
    });
  });
  t.after(backend.stop);

  const gateway = await startGateway({ PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl });
  t.after(gateway.stop);

  const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, textImageRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    status: "succeeded",
    images: [
      { url: "https://cdn.example.com/generated/https.png", width: 1024, height: 768, format: "png" },
      { url: "http://cdn.example.com/generated/http.png", width: 512, height: 512, format: "png" }
    ],
    warnings: []
  });
  assertNoForbiddenFields(response.body);
});

test("ai-tu gateway returns not configured instead of mock success", async (t) => {
  const gateway = await startGateway();
  t.after(gateway.stop);

  const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, textImageRequest());
  assert.equal(response.status, 503);
  assertV36Error(response.body, "PROMPT_IMAGE_BACKEND_NOT_CONFIGURED");
});

test("ai-tu gateway malformed JSON uses V3.6 invalid schema envelope", async (t) => {
  const gateway = await startGateway();
  t.after(gateway.stop);

  const response = await fetch(`${gateway.baseUrl}/api/v1/image-generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{\"task_type\":\"text_image\""
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assertV36Error(payload, "INVALID_REQUEST_SCHEMA");
});

test("ai-tu gateway blocks prompt-image backend self reference", async (t) => {
  const port = await freePort();
  const gateway = await startGateway({
    PORT: String(port),
    PROMPT_IMAGE_BACKEND_BASE_URL: `http://127.0.0.1:${port}`
  });
  t.after(gateway.stop);

  const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, textImageRequest());
  assert.equal(response.status, 400);
  assertV36Error(response.body, "PROMPT_IMAGE_BACKEND_SELF_REFERENCE");
});

test("ai-tu gateway validates references and output before backend submit", async (t) => {
  const backendCalls = [];
  const backend = await startBackend(async (request, response, body) => {
    backendCalls.push(body);
    sendJson(response, 200, { status: "succeeded", images: [{ url: "https://cdn.example.com/never.png" }], warnings: [] });
  });
  t.after(backend.stop);
  const gateway = await startGateway({ PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl });
  t.after(gateway.stop);

  const invalidCases = [
    [{ ...textImageRequest(), references: [validReference()] }, "REFERENCES_NOT_ALLOWED"],
    [{ task_type: "image_reference", prompt: "基于参考图生成。", references: [], output: textImageRequest().output }, "REFERENCE_REQUIRED"],
    [{ task_type: "character_multiview", prompt: "生成角色三视图。", references: [], output: textImageRequest().output }, "REFERENCE_REQUIRED"],
    [{ task_type: "scene_multiview", prompt: "生成场景多视角。", references: [], output: textImageRequest().output }, "REFERENCE_REQUIRED"],
    [{ task_type: "prop_multiview", prompt: "生成道具多视角。", references: [], output: textImageRequest().output }, "REFERENCE_REQUIRED"],
    [{ task_type: "storyboard", prompt: "生成分镜。", references: [], output: textImageRequest().output }, "REFERENCE_REQUIRED"],
    [{ task_type: "image_reference", prompt: "x", references: [{ ...validReference(), reference_id: "" }], output: textImageRequest().output }, "REFERENCE_ID_REQUIRED"],
    [{ task_type: "image_reference", prompt: "x", references: [validReference(), validReference()], output: textImageRequest().output }, "DUPLICATE_REFERENCE_ID"],
    [{ task_type: "image_reference", prompt: "x", references: [{ ...validReference(), role: "bad_role" }], output: textImageRequest().output }, "INVALID_REFERENCE_ROLE"],
    [{ task_type: "image_reference", prompt: "x", references: [{ ...validReference(), entity_type: "bad_type" }], output: textImageRequest().output }, "REFERENCE_ENTITY_TYPE_INVALID"],
    [{ task_type: "image_reference", prompt: "x", references: [{ ...validReference(), url: "/relative/ref.png" }], output: textImageRequest().output }, "REFERENCE_URL_INVALID"],
    [{ ...textImageRequest(), output: { ...textImageRequest().output, aspect_ratio: "bad" } }, "INVALID_REQUEST_SCHEMA"]
  ];

  for (const [body, code] of invalidCases) {
    const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, body);
    assert.equal(response.status, 400, code);
    assertV36Error(response.body, code);
  }
  assert.equal(backendCalls.length, 0);
});

test("ai-tu gateway rejects backend base64, data URL, and raw provider payloads", async (t) => {
  const cases = [
    { images: [{ b64_json: sampleBase64() }] },
    { images: [{ url: `data:image/png;base64,${sampleBase64()}` }] },
    { data: [{ b64_json: sampleBase64() }], raw_provider_payload: { output: "binary" } }
  ];

  for (const payload of cases) {
    const backend = await startBackend(async (request, response) => {
      sendJson(response, 200, {
        status: "succeeded",
        ...payload
      });
    });
    t.after(backend.stop);
    const gateway = await startGateway({ PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl });
    t.after(gateway.stop);

    const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, textImageRequest());
    assert.equal(response.status, 502);
    assertV36Error(response.body, "PROMPT_IMAGE_BACKEND_INVALID_RESPONSE");
    assertNoForbiddenFields(response.body);
  }
});

test("ai-tu gateway rejects backend failed status and unsafe image URLs", async (t) => {
  const cases = [
    [{ status: "failed", error: { code: "UPSTREAM_FAILED", message: "backend failed" }, images: [{ url: "https://cdn.example.com/nope.png" }] }, "UPSTREAM_FAILED", 502],
    [{ status: "needs_clarification", error: { code: "REFERENCE_REQUIRED", message: "need reference" }, images: [{ url: "https://cdn.example.com/nope.png" }] }, "REFERENCE_REQUIRED", 400],
    [{ status: "succeeded", images: [{ url: "http://127.0.0.1/private.png" }], warnings: [] }, "PROMPT_IMAGE_BACKEND_INVALID_RESPONSE", 502]
  ];

  for (const [payload, code, status] of cases) {
    const backend = await startBackend(async (request, response) => {
      sendJson(response, 200, payload);
    });
    t.after(backend.stop);
    const gateway = await startGateway({ PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl });
    t.after(gateway.stop);
    const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, textImageRequest());
    assert.equal(response.status, status);
    assertV36Error(response.body, code);
  }
});

test("ai-tu gateway does not forward backend internals in public response", async (t) => {
  const backend = await startBackend(async (request, response) => {
    sendJson(response, 200, {
      status: "succeeded",
      images: [{
        url: "https://cdn.example.com/generated/clean.webp",
        width: 512,
        height: 512,
        format: "webp",
        b64_json: sampleBase64(),
        final_prompt: "secret final",
        provider_payload: { token: "secret-token" }
      }],
      final_prompt: "secret final",
      compiled_prompt: "secret compiled",
      raw_provider_payload: { token: "secret-token" },
      warnings: [
        { code: "VISIBLE", message: "visible warning", token: "secret-token" },
        { code: "TOKEN_LEAK", message: "secret-token" }
      ]
    });
  });
  t.after(backend.stop);
  const gateway = await startGateway({ PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl });
  t.after(gateway.stop);

  const response = await postJson(`${gateway.baseUrl}/api/v1/image-generations`, textImageRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["images", "status", "warnings"]);
  assert.deepEqual(Object.keys(response.body.images[0]).sort(), ["format", "height", "url", "width"]);
  assert.deepEqual(response.body.warnings, [{ code: "VISIBLE", message: "visible warning" }]);
  assertNoForbiddenFields(response.body);
});

test("ai-tu gateway legacy /api/image-jobs no longer creates or enqueues jobs", async (t) => {
  const backendCalls = [];
  const backend = await startBackend(async (request, response, body) => {
    backendCalls.push(body);
    sendJson(response, 200, { status: "succeeded", images: [{ url: "https://cdn.example.com/should-not-call.png" }], warnings: [] });
  });
  t.after(backend.stop);
  const gateway = await startGateway({ PROMPT_IMAGE_BACKEND_BASE_URL: backend.baseUrl });
  t.after(gateway.stop);

  const response = await postJson(`${gateway.baseUrl}/api/image-jobs`, { prompt: "legacy path" });
  assert.equal(response.status, 410);
  assertV36Error(response.body, "LEGACY_IMAGE_JOBS_DISABLED");
  assert.equal("jobId" in response.body, false);
  assert.equal(backendCalls.length, 0);
});

test("ai-tu gateway /api/config does not expose configured key values", async (t) => {
  const gateway = await startGateway({
    PROMPT_IMAGE_BACKEND_BASE_URL: "https://backend.example.com"
  });
  t.after(gateway.stop);
  const saved = await postJson(`${gateway.baseUrl}/api/config`, {
    upstreamMode: "live",
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    keyMode: "single",
    apiKey: "legacy-image-secret",
    imageHostMode: "imgbb",
    imageHostUploadUrl: "https://api.imgbb.com/1/upload",
    imageHostApiKey: "imgbb-secret",
    requestTimeoutSeconds: 900
  });
  assert.equal(saved.status, 200);
  assertConfigDoesNotLeakSecrets(saved.body);
  assert.equal(saved.body.config.requestTimeoutSeconds, 900);

  const response = await fetch(`${gateway.baseUrl}/api/config`, { cache: "no-store" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assertConfigDoesNotLeakSecrets(payload);
  assert.equal(payload.config.apiKeyConfigured, true);
  assert.equal(payload.config.imageHostApiKeyConfigured, true);
  assert.equal(payload.config.requestTimeoutSeconds, 900);
});

function assertConfigDoesNotLeakSecrets(payload) {
  const text = JSON.stringify(payload);
  assert.equal(text.includes("legacy-image-secret"), false);
  assert.equal(text.includes("imgbb-secret"), false);
  assert.equal("apiKey" in payload.config, false);
  assert.equal("apiKeys" in payload.config, false);
  assert.equal("imageHostApiKey" in payload.config, false);
}

test("ai-tu page uses /api/v1/image-generations and V3.6 builders", () => {
  const html = readFileSync(HTML_FILE, "utf8");
  const gateway = readFileSync(SERVER_FILE, "utf8");
  const textBuilder = extractFunctionBody(html, "buildTextImageRequest");
  const imageBuilder = extractFunctionBody(html, "buildImageReferenceRequest");
  assert.match(html, /帧界图片生成器极速版/);
  assert.match(html, /const finalApiEndpoint = "\/api\/v1\/image-generations"/);
  assert.match(html, /fetch\(finalApiEndpoint/);
  assert.doesNotMatch(html, /fetch\(`\/api\/image-jobs/);
  assert.doesNotMatch(html, /fetch\("\/api\/image-jobs/);
  assert.match(html, /function buildTextImageRequest\(\)/);
  assert.match(textBuilder, /task_type: "text_image"/);
  assert.match(textBuilder, /references: \[\]/);
  assert.doesNotMatch(textBuilder, /optimizerTaskType/);
  assertNoForbiddenRequestFieldSource(textBuilder);
  assert.match(html, /function buildImageReferenceRequest\(\)/);
  assertNoForbiddenRequestFieldSource(imageBuilder);
  assert.match(html, /\.\.\.manualReferences/);
  assert.match(html, /uploadedReferencesFromSlots\(refList, manualReferences\)/);
  assert.match(html, /图生图模式请先上传参考图，且参考图必须已得到 http\(s\) URL。/);
  assert.match(gateway, /url\.pathname === "\/api\/v1\/image-generations"/);
  assert.match(gateway, /legacyImageJobsDisabledPayload/);
  assert.doesNotMatch(gateway, /url\.pathname === "\/api\/image-jobs"[\s\S]{0,240}createJob/);
  assert.doesNotMatch(gateway, /url\.pathname === "\/api\/image-jobs"[\s\S]{0,240}enqueue/);
});

function textImageRequest() {
  return {
    task_type: "text_image",
    prompt: "生成一张山间晨雾图。",
    references: [],
    output: {
      count: 1,
      aspect_ratio: "16:9",
      quality: "high",
      return_format: "url",
      language: "zh-CN"
    }
  };
}

function validReference() {
  return {
    reference_id: "ref_1",
    entity_name: "参考图",
    entity_type: "scene",
    role: "scene_reference",
    url: "https://cdn.example.com/ref.png",
    mime_type: "image/png",
    display_name: "ref.png",
    description: "参考图"
  };
}

function assertV36Error(payload, code) {
  assert.equal(payload.status, "failed");
  assert.deepEqual(Object.keys(payload).sort(), ["error", "images", "status", "warnings"]);
  assert.equal(payload.error.code, code);
  assert.equal(typeof payload.error.message, "string");
  assert.deepEqual(payload.images, []);
  assert.deepEqual(payload.warnings, []);
  assertNoForbiddenFields(payload);
}

function assertNoForbiddenFields(payload) {
  const text = JSON.stringify(payload);
  for (const token of FORBIDDEN_TOKENS) {
    assert.equal(text.includes(token), false, `forbidden token leaked: ${token}`);
  }
}

function assertV36BackendRequestWhitelist(payload) {
  assert.deepEqual(Object.keys(payload).sort(), ["output", "prompt", "reference_policy", "references", "task_type"]);
  assert.deepEqual(Object.keys(payload.output).sort(), ["aspect_ratio", "count", "language", "quality", "return_format"]);
  assert.equal(payload.output.return_format, "url");
  assert.equal(payload.output.language, "zh-CN");
  assert.equal("return_format" in payload, false, "forbidden top-level return_format forwarded");
  for (const field of FORBIDDEN_REQUEST_FIELDS) {
    assert.equal(field in payload, false, `forbidden backend request field forwarded: ${field}`);
    assert.equal(field in payload.output, false, `forbidden backend output field forwarded: ${field}`);
  }
  const text = JSON.stringify(payload);
  assert.equal(text.includes("data:image"), false);
  assert.equal(text.includes("raw provider"), false);
  assert.equal(text.includes("secret-api-key"), false);
  assert.equal(text.includes("secret-token"), false);
}

function assertNoForbiddenRequestFieldSource(source) {
  for (const field of ["model", "mode", "size", "output_format"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${field}\\s*:`), `frontend request builder still sets ${field}`);
  }
  for (const field of ["resolution", "format"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${field}\\s*:`), `frontend request builder still sets top-level ${field}`);
  }
  assert.doesNotMatch(source, /return_format:\s*"png"/, "frontend request builder still sets top-level return_format=png");
}

function extractFunctionBody(source, name) {
  const signature = `function ${name}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `${name} body not found`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`${name} body not closed`);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {}
  };
}

async function startGateway(extraEnv = {}) {
  const port = Number(extraEnv.PORT || await freePort());
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-gateway-contract-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({}), "utf8");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: GATEWAY_ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      RUNTIME_CONFIG_FILE: configFile,
      IMAGE_HOST_MODE: "local",
      PROMPT_IMAGE_BACKEND_BASE_URL: "",
      PROMPT_IMAGE_BACKEND_GENERATION_PATH: "",
      PROMPT_IMAGE_BACKEND_API_KEY: "",
      PROMPT_IMAGE_BACKEND_TIMEOUT_SECONDS: "2",
      ...extraEnv,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\nGateway output:\n${output}`);
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolveStop) => child.once("exit", resolveStop));
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function startBackend(handler) {
  const port = await freePort();
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    await handler(request, response, body);
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sampleBase64() {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
}

async function waitForHttp(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status < 500) return;
    } catch {
      // Retry until server is listening.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`server did not become reachable: ${url}`);
}

async function freePort() {
  const { createServer: createNetServer } = await import("node:net");
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}
