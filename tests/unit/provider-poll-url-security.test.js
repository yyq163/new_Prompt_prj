import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProviderResult,
  resolveAuthorizedFetchUrl,
  resolveAuthorizedUpstreamUrl,
  fetchUpstream
} from "../../src/providers/ai-tu-provider-adapter.js";
import { handleImageGeneration } from "../../src/routes/image-generations.js";

const TEST_KEY = "test-key";

function providerConfig(overrides = {}) {
  return {
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    keyMode: "single",
    apiKey: TEST_KEY,
    apiKeys: [TEST_KEY],
    requestTimeoutSeconds: 10,
    retryAttempts: 1,
    pollTimeoutSeconds: 10,
    pollIntervalSeconds: 1,
    pollBaseUrl: "https://provider.example.com/v1/tasks",
    ...overrides
  };
}

function recordingFetch(calls) {
  return async (url, init) => {
    calls.push({ url, authorization: init?.headers?.Authorization || "" });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ url: "https://provider.example.com/async.png" }] }),
      headers: { get: () => null }
    };
  };
}

test("evil third-party poll URLs are rejected before any fetch or Authorization", async () => {
  const evilUrls = [
    { status_url: "https://evil.example/poll" },
    { status_url: "https://evil.example/v1/tasks/task_001" },
    { poll_url: "https://attacker.example/v1/tasks/task_001" }
  ];
  for (const payload of evilUrls) {
    const calls = [];
    await assert.rejects(
      () => normalizeProviderResult(payload, "png", recordingFetch(calls), providerConfig()),
      /provider poll url/
    );
    assert.deepEqual(calls, [], JSON.stringify(payload));
  }
});

test("localhost, loopback, private and link-local poll URLs are rejected", async () => {
  const unsafe = [
    { poll_url: "http://localhost:9999/v1/tasks/task_001" },
    { poll_url: "http://127.0.0.1:9999/v1/tasks/task_001" },
    { poll_url: "http://10.0.0.5/v1/tasks/task_001" },
    { poll_url: "http://172.16.0.5/v1/tasks/task_001" },
    { poll_url: "http://192.168.1.5/v1/tasks/task_001" },
    { poll_url: "http://169.254.169.254/v1/tasks/task_001" },
    { poll_url: "http://0.0.0.0/v1/tasks/task_001" },
    { poll_url: "http://[::1]:9999/v1/tasks/task_001" },
    { poll_url: "http://[fe80::1]/v1/tasks/task_001" },
    { poll_url: "http://[fc00::1]/v1/tasks/task_001" },
    { poll_url: "http://[::ffff:127.0.0.1]/v1/tasks/task_001" },
    { poll_url: "http://2130706433/v1/tasks/task_001" },
    { poll_url: "http://0177.0.0.1/v1/tasks/task_001" }
  ];
  for (const payload of unsafe) {
    const calls = [];
    await assert.rejects(
      () => normalizeProviderResult(payload, "png", recordingFetch(calls), providerConfig()),
      /provider poll url/
    );
    assert.deepEqual(calls, [], JSON.stringify(payload));
  }
});

test("malformed or dangerous-scheme poll URLs do not crash and are rejected", async () => {
  const malformed = [
    { statusUrl: "not a url with spaces" },
    { status_url: "file:///tmp/task_001" },
    { status_url: "javascript:alert(1)" },
    { status_url: "//evil.example/v1/tasks/task_001" },
    { status_url: "https://user:pass@provider.example.com/v1/tasks/task_001" },
    { statusUrl: "https://provider.example.com/not-v1/task_001" }
  ];
  for (const payload of malformed) {
    const calls = [];
    await assert.rejects(
      () => normalizeProviderResult(payload, "png", recordingFetch(calls), providerConfig()),
      /provider poll url|http 或 https/
    );
    assert.deepEqual(calls, [], JSON.stringify(payload));
  }
});

test("empty or whitespace status_url does not crash and does not trigger an outbound fetch", async () => {
  for (const payload of [{ status_url: "" }, { status_url: "   " }, {}]) {
    const calls = [];
    await assert.rejects(
      () => normalizeProviderResult(payload, "png", recordingFetch(calls), providerConfig()),
      /接口返回里没有找到可访问的图片 URL/
    );
    assert.deepEqual(calls, [], JSON.stringify(payload));
  }
});

test("same-origin absolute poll URL is allowed and Authorization is sent only to approved provider", async () => {
  const config = providerConfig();
  const calls = [];
  const url = "https://provider.example.com/v1/tasks/task_001";
  await fetchUpstream(url, (credential) => ({
    method: "GET",
    headers: { Authorization: `Bearer ${credential.key}` }
  }), recordingFetch(calls), config);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].authorization, `Bearer ${TEST_KEY}`);
});

test("relative poll paths resolve against approved provider origin and pollBaseUrl", async () => {
  const config = providerConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    pollBaseUrl: "https://poll.example.com/v1/polls"
  });
  // Leading "/" is resolved against the generations endpoint origin;
  // unprefixed/"./" paths are resolved against pollBaseUrl when configured.
  const cases = [
    { input: "/v1/polls/task_001", expected: "https://provider.example.com/v1/polls/task_001" },
    { input: "nested/task_002", expected: "https://poll.example.com/v1/polls/nested/task_002" },
    { input: "task_003", expected: "https://poll.example.com/v1/polls/task_003" },
    { input: "./task_004", expected: "https://poll.example.com/v1/polls/task_004" }
  ];
  for (const { input, expected } of cases) {
    assert.equal(resolveAuthorizedUpstreamUrl(input, config), expected);
    const calls = [];
    await fetchUpstream(input, (credential) => ({
      method: "GET",
      headers: { Authorization: `Bearer ${credential.key}` }
    }), recordingFetch(calls), config);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, expected);
    assert.equal(calls[0].authorization, `Bearer ${TEST_KEY}`);
  }
});

test("Authorization token is never emitted for rejected poll URLs", async () => {
  const payload = { status_url: "https://evil.example/poll?token=secret" };
  try {
    await normalizeProviderResult(payload, "png", async () => {
      throw new Error("fetch must not be called for unsafe poll URL");
    }, providerConfig());
    assert.fail("should have thrown");
  } catch (error) {
    const text = JSON.stringify(error);
    assert.equal(text.includes("evil.example"), false);
    assert.equal(text.includes("Authorization"), false);
    assert.equal(text.includes(TEST_KEY), false);
    assert.equal(text.includes("secret"), false);
  }
});

test("public error response does not leak poll URL, Authorization header or key", async () => {
  const result = await handleImageGeneration({
    task_type: "text_image",
    prompt: "生成山水。",
    references: [],
    output: { count: 1, aspect_ratio: "1:1", quality: "high" }
  }, {
    provider: async ({ fetchImpl }) => {
      await normalizeProviderResult(
        { status_url: "https://evil.example/poll?token=secret" },
        "png",
        fetchImpl,
        providerConfig()
      );
      return { status: "succeeded", images: [] };
    },
    fetchImpl: async () => {
      throw new Error("unsafe poll URL must not be fetched");
    }
  });
  assert.equal(result.payload.status, "failed");
  const publicText = JSON.stringify(result.payload);
  assert.equal(publicText.includes("evil.example"), false);
  assert.equal(publicText.includes("Authorization"), false);
  assert.equal(publicText.includes(TEST_KEY), false);
  assert.equal(publicText.includes("secret"), false);
});

test("configured submit endpoints are separated from provider-returned poll URL allowlist", () => {
  const config = providerConfig();
  assert.equal(
    resolveAuthorizedFetchUrl(config.baseUrl, config),
    "https://provider.example.com/v1/images/generations"
  );
  assert.equal(
    resolveAuthorizedFetchUrl(config.imageEditUrl, config),
    "https://provider.example.com/v1/images/edits"
  );
  assert.equal(
    resolveAuthorizedFetchUrl("https://provider.example.com/v1/tasks/task_001", config),
    "https://provider.example.com/v1/tasks/task_001"
  );
  assert.throws(
    () => resolveAuthorizedFetchUrl("https://evil.example/v1/tasks/task_001", config),
    /provider poll url/
  );

  const localSubmitConfig = {
    ...config,
    baseUrl: "http://127.0.0.1:18080/v1/images/generations",
    imageEditUrl: "http://127.0.0.1:18080/v1/images/edits"
  };
  assert.equal(resolveAuthorizedFetchUrl(localSubmitConfig.baseUrl, localSubmitConfig), localSubmitConfig.baseUrl);
  assert.equal(resolveAuthorizedFetchUrl(localSubmitConfig.imageEditUrl, localSubmitConfig), localSubmitConfig.imageEditUrl);
  assert.throws(
    () => resolveAuthorizedFetchUrl("http://127.0.0.1:18080/v1/tasks/task_001", localSubmitConfig),
    /provider poll url/
  );
});
