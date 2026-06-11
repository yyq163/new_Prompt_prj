import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const FORBIDDEN_RESPONSE_TOKENS = [
  "final_prompt",
  "compiled_prompt",
  "internal_prompt",
  "provider_payload",
  "provider_internal_payload",
  "raw_provider_payload",
  "b64_json",
  "base64",
  "data:image",
  "callback_status",
  "ragflow_state",
  "fallback_status",
  "apiKey"
];

test("HTTP invalid JSON body handling for final and prompt optimization routes", async (t) => {
  const app = await startTestServer();
  t.after(async () => {
    await app.stop();
  });

  await assertInvalidBody({
    url: `${app.baseUrl}/api/v1/image-generations`,
    body: "{\"task_type\":\"text_image\"",
    expectedMessage: "请求体不是合法 JSON"
  });

  await assertInvalidBody({
    url: `${app.baseUrl}/api/v1/image-generations`,
    body: JSON.stringify({ prompt: "x".repeat(2000) }),
    expectedMessage: "请求体过大"
  });

  await assertInvalidBody({
    url: `${app.baseUrl}/api/v1/prompt-optimizations`,
    body: "{\"task_type\":\"text_image\"",
    expectedMessage: "请求体不是合法 JSON"
  });

  await assertInvalidBody({
    url: `${app.baseUrl}/api/v1/prompt-optimizations`,
    body: JSON.stringify({ prompt: "x".repeat(2000) }),
    expectedMessage: "请求体过大"
  });
});

test("HTTP final route still accepts legal V1.4 JSON into the normal provider-gated path", async (t) => {
  const app = await startTestServer();
  t.after(async () => {
    await app.stop();
  });

  const response = await postRaw(`${app.baseUrl}/api/v1/image-generations`, JSON.stringify({
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
  }));
  assert.equal(response.status, 503);
  assert.equal(response.body.status, "failed");
  assert.equal(response.body.error_code, "PROVIDER_CONFIG_MISSING");
  assertNoForbiddenFields(response.body);
});

async function assertInvalidBody({ url, body, expectedMessage }) {
  const response = await postRaw(url, body);
  assert.equal(response.status, 400);
  assert.equal(response.body.request_id, "");
  assert.equal(response.body.status, "failed");
  assert.equal(response.body.error_code, "INVALID_REQUEST_SCHEMA");
  assert.match(response.body.message, new RegExp(expectedMessage));
  assert.equal("generation_id" in response.body, false);
  assert.equal("trace_id" in response.body, false);
  assert.equal("images" in response.body, false);
  assertNoForbiddenFields(response.body);
}

async function postRaw(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {}
  };
}

function assertNoForbiddenFields(payload) {
  const text = JSON.stringify(payload);
  for (const token of FORBIDDEN_RESPONSE_TOKENS) {
    assert.equal(text.includes(token), false, `forbidden token leaked: ${token}`);
  }
}

async function startTestServer() {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "http-invalid-body-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({}), "utf8");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      MAX_BODY_SIZE: "512b",
      AI_TU_RUNTIME_CONFIG_FILE: configFile,
      IMAGE_API_BASE: "",
      IMAGE_MODEL: "",
      IMAGE_MODEL_IMAGE: "",
      IMAGE_MODEL_FOR_IMAGE: "",
      IMAGE_API_KEY: "",
      IMAGE_API_KEYS: "",
      RAGFLOW_ENHANCEMENT_URL: ""
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
    await waitForHealth(`http://127.0.0.1:${port}/health`);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\nserver output:\n${output}`);
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

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry until the child process finishes listening.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("test server did not become healthy");
}

async function freePort() {
  const { createServer } = await import("node:net");
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}
