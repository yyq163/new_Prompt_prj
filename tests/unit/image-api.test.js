import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleImageGeneration } from "../../src/routes/image-generations.js";
import { extractEntityMentions } from "../../src/core/entity-mentions.js";
import { resolveReferences } from "../../src/core/reference-binding.js";
import { normalizeRequest, FORBIDDEN_PUBLIC_FIELDS } from "../../src/core/runtime.js";
import { validateEnhancement, extractShotKeys } from "../../src/core/ragflow-enhancement.js";
import { inferStoryboardPathForTest } from "../../src/core/prompt-compiler.js";
import { defaultProviderConfig, extractImageUrls, hasRequiredProviderConfig, normalizeProviderResult, sanitizeProviderConfig } from "../../src/providers/ai-tu-provider-adapter.js";

const imageUrl = "https://provider.example.com/generated.png";

test("text_image without references succeeds with public response contract", async () => {
  const result = await call({
    task_type: "text_image",
    prompt: "生成一张山间晨雾图。",
    references: []
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.generation_mode, "text_to_image");
  assert.equal(result.payload.images[0].url, imageUrl);
  assertNoForbidden(result.payload);
});

test("text_image with references returns REFERENCES_NOT_ALLOWED", async () => {
  const result = await call({
    task_type: "text_image",
    prompt: "生成 @萧昭宁。",
    references: [characterRef()]
  });
  assert.equal(result.payload.status, "failed");
  assert.equal(result.payload.error_code, "REFERENCES_NOT_ALLOWED");
  assert.match(result.payload.trace_id, /^trace_/);
});

test("schema errors still include trace_id and no internal fields", async () => {
  const result = await call({
    task_type: "",
    prompt: "生成山水。",
    references: []
  });
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal(result.payload.error_code, "UNSUPPORTED_TASK_TYPE");
  assert.match(result.payload.trace_id, /^trace_/);
  assertNoForbidden(result.payload);
});

test("image_reference with references succeeds", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁 生成新图。",
    references: [characterRef()]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.generation_mode, "image_to_image");
});

test("character_multiview character primary succeeds", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 的四视图。",
    references: [characterRef({ usage: "primary" })]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.normalized.references_used[0].role, "character_reference");
});

test("character_multiview character primary plus scene auxiliary succeeds", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的角色设定。",
    references: [characterRef({ usage: "primary" }), sceneRef({ usage: "auxiliary" })]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.normalized.references_used.length, 2);
});

test("scene_multiview scene primary plus character auxiliary succeeds", async () => {
  const result = await call({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [characterRef({ usage: "auxiliary" }), sceneRef({ usage: "primary" })]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.task_type, "scene_multiview");
  assert.equal(result.payload.normalized.entity_mentions.length, 2);
});

test("prop_multiview prop primary succeeds", async () => {
  const result = await call({
    task_type: "prop_multiview",
    prompt: "生成 @铜镜 的道具多视图。",
    references: [propRef({ usage: "primary" })]
  });
  assert.equal(result.payload.status, "succeeded");
});

test("storyboard script enhancement uses script-to-storyboard path internally", () => {
  const request = normalizeRequest({ task_type: "storyboard", prompt: "萧昭宁入营，烛火摇动。", references: [] });
  const path = inferStoryboardPathForTest(request, {
    storyboard_processing: "script_to_storyboard",
    scene_summary: "入营",
    action_stages: ["入场", "对视"],
    shot_plan: ["镜头1 入营", "镜头2 对视"]
  });
  assert.equal(path, "script_to_storyboard");
});

test("storyboard existing shot list preserves count and order", () => {
  const prompt = "镜头1：推门入营\n镜头2：抬头看向烛火";
  const request = normalizeRequest({ task_type: "storyboard", prompt, references: [] });
  const binding = { resolved_references: [] };
  const validation = validateEnhancement({
    storyboard_processing: "normalize_shot_list",
    normalized_shot_plan: [
      { original_order: 1, core_action: "推门入营", camera: "中景" },
      { original_order: 2, core_action: "抬头看向烛火", camera: "近景" }
    ]
  }, { request, binding });
  assert.ok(validation.enhancement);
  assert.equal(inferStoryboardPathForTest(request, validation.enhancement), "normalized_existing_shots");
  assert.deepEqual(extractShotKeys(prompt), ["1", "2"]);
});

test("storyboard complete prompt preserve path", () => {
  const request = normalizeRequest({ task_type: "storyboard", prompt: "完整故事板提示词：左侧规划区，右侧剧情宫格。", references: [] });
  const path = inferStoryboardPathForTest(request, {
    storyboard_processing: "preserve_full_prompt",
    missing_constraints: ["补充左侧光影变化示意"]
  });
  assert.equal(path, "preserve_full_prompt");
});

test("RAGFlow missing/failing enhancement still succeeds with local compiler and provider", async () => {
  const old = process.env.RAGFLOW_ENHANCEMENT_URL;
  process.env.RAGFLOW_ENHANCEMENT_URL = "http://127.0.0.1:1/nope";
  const result = await call({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [characterRef({ usage: "auxiliary" }), sceneRef({ usage: "primary" })]
  }, {
    fetchImpl: async () => { throw new Error("connection refused"); }
  });
  restoreEnv("RAGFLOW_ENHANCEMENT_URL", old);
  assert.equal(result.payload.status, "succeeded");
  assertNoForbidden(result.payload);
});

test("RAGFlow output final_prompt is discarded", () => {
  const request = normalizeRequest({ task_type: "storyboard", prompt: "剧情段落", references: [] });
  const validation = validateEnhancement(JSON.stringify({ final_prompt: "secret" }), { request, binding: { resolved_references: [] } });
  assert.equal(validation.enhancement, null);
  assert.equal(validation.discarded, "prompt_leak");
});

test("RAGFlow unauthorized reference_id is discarded", () => {
  const request = normalizeRequest({ task_type: "image_reference", prompt: "参考 @萧昭宁", references: [characterRef()] });
  const binding = resolveReferences(request, extractEntityMentions(request.prompt));
  const validation = validateEnhancement({ reference_id: "ref_other" }, { request, binding });
  assert.equal(validation.enhancement, null);
  assert.equal(validation.discarded, "unauthorized_reference");
});

test("duplicate reference_id fails", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [characterRef(), characterRef()]
  });
  assert.equal(result.payload.error_code, "DUPLICATE_REFERENCE_ID");
});

test("same entity and role multiple references without usage fails", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [
      characterRef({ reference_id: "ref_a", usage: "" }),
      characterRef({ reference_id: "ref_b", url: "https://example.com/b.png", usage: "" })
    ]
  });
  assert.equal(result.payload.error_code, "DUPLICATE_ENTITY_ROLE_REFERENCE");
});

test("multiple primary references fails", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [
      characterRef({ reference_id: "ref_a", usage: "primary" }),
      characterRef({ reference_id: "ref_b", url: "https://example.com/b.png", usage: "primary" })
    ]
  });
  assert.equal(result.payload.error_code, "MULTIPLE_PRIMARY_REFERENCES");
});

test("unbound_entity warn succeeds with warning", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "生成 @萧昭宁 和 @营帐。",
    references: [characterRef()],
    reference_policy: { unbound_entity: "warn" }
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.warnings[0].code, "ENTITY_REFERENCE_NOT_FOUND");
});

test("unbound_entity block returns needs_clarification", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "生成 @萧昭宁 和 @营帐。",
    references: [characterRef()],
    reference_policy: { unbound_entity: "block" }
  });
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal(result.payload.error_code, "ENTITY_REFERENCE_NOT_FOUND");
});

test("provider base64-only response is unsupported", () => {
  assert.throws(() => extractImageUrls({ data: [{ b64_json: "abc" }] }), /上游返回的图片格式当前不支持/);
});

test("provider URL response mapper accepts url, image_url, and output_url", () => {
  const images = extractImageUrls({
    data: [
      { url: "https://provider.example.com/a.png", width: 100 },
      { image_url: "https://provider.example.com/b.webp", height: 120 },
      { output_url: "https://provider.example.com/c.jpeg" }
    ]
  });
  assert.deepEqual(images.map((item) => item.url), [
    "https://provider.example.com/a.png",
    "https://provider.example.com/b.webp",
    "https://provider.example.com/c.jpeg"
  ]);
});

test("provider async response polls internally and returns URL without exposing running state", async () => {
  const calls = [];
  const images = await normalizeProviderResult({ task_id: "task_001" }, "png", async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ url: "https://provider.example.com/async.png" }] }),
      headers: { get: () => null }
    };
  }, {
    baseUrl: "https://provider.example.com/v1/images/generations",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    keyMode: "single",
    apiKey: "test-key",
    apiKeys: ["test-key"],
    requestTimeoutSeconds: 10,
    retryAttempts: 1,
    pollTimeoutSeconds: 10,
    pollIntervalSeconds: 1,
    pollBaseUrl: "https://provider.example.com/v1/tasks"
  });
  assert.deepEqual(images.map((item) => item.url), ["https://provider.example.com/async.png"]);
  assert.equal(calls[0], "https://provider.example.com/v1/tasks/task_001");
});

test("missing provider config returns PROVIDER_CONFIG_MISSING through real adapter", async () => {
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;
  const oldBase = process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  process.env.IMAGE_API_BASE = "https://provider.example.com/v1/images/generations";
  const result = await handleImageGeneration({
    task_type: "text_image",
    prompt: "生成山水。",
    references: []
  });
  restoreEnv("IMAGE_API_KEY", oldKey);
  restoreEnv("IMAGE_API_KEYS", oldKeys);
  restoreEnv("IMAGE_API_BASE", oldBase);
  assert.equal(result.payload.error_code, "PROVIDER_CONFIG_MISSING");
});

test("provider config requires base URL, model, and at least one key", () => {
  assert.equal(hasRequiredProviderConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    model: "gpt-image-2",
    apiKey: "test-key"
  })), true);
  assert.equal(hasRequiredProviderConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    model: "",
    apiKey: "test-key"
  })), false);
  assert.equal(hasRequiredProviderConfig(sanitizeProviderConfig({
    baseUrl: "",
    model: "gpt-image-2",
    apiKey: "test-key"
  })), false);
  assert.equal(hasRequiredProviderConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    model: "gpt-image-2",
    apiKey: ""
  })), false);
});

test("provider config can be read from ai-tu runtime config file without printing values", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-config-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    baseUrl: "https://provider.example.com/v1/images/generations",
    model: "gpt-image-2",
    imageModel: "gpt-image-2-all",
    keyMode: "single",
    apiKey: "test-key",
    requestTimeoutSeconds: 30,
    retryAttempts: 2
  }), "utf8");

  const oldConfigFile = process.env.AI_TU_RUNTIME_CONFIG_FILE;
  const oldBase = process.env.IMAGE_API_BASE;
  const oldModel = process.env.IMAGE_MODEL;
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;
  delete process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_MODEL;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  process.env.AI_TU_RUNTIME_CONFIG_FILE = configFile;

  try {
    const config = defaultProviderConfig();
    assert.equal(hasRequiredProviderConfig(config), true);
    assert.equal(config.baseUrl, "https://provider.example.com/v1/images/generations");
    assert.equal(config.model, "gpt-image-2");
    assert.equal(config.imageModel, "gpt-image-2-all");
  } finally {
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_MODEL", oldModel);
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider config infers ai-tu generations endpoint and model from imageModel", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-config-partial-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    imageModel: "gpt-image-2-all",
    keyMode: "single",
    apiKey: "test-key",
    requestTimeoutSeconds: 30,
    retryAttempts: 2
  }), "utf8");

  const oldConfigFile = process.env.AI_TU_RUNTIME_CONFIG_FILE;
  const oldBase = process.env.IMAGE_API_BASE;
  const oldModel = process.env.IMAGE_MODEL;
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;
  delete process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_MODEL;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  process.env.AI_TU_RUNTIME_CONFIG_FILE = configFile;

  try {
    const config = defaultProviderConfig();
    assert.equal(hasRequiredProviderConfig(config), true);
    assert.equal(config.baseUrl, "https://memefast.top/v1/images/generations");
    assert.equal(config.model, "gpt-image-2-all");
    assert.equal(config.imageModel, "gpt-image-2-all");
  } finally {
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_MODEL", oldModel);
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    rmSync(dir, { recursive: true, force: true });
  }
});

function call(body, options = {}) {
  return handleImageGeneration({
    reference_policy: { unbound_entity: "warn" },
    output: { count: 1, aspect_ratio: "16:9", quality: "high" },
    ...body
  }, {
    provider: async () => ({
      status: "succeeded",
      images: [{ image_id: "img_001", url: imageUrl, width: 1920, height: 1080, format: "png" }]
    }),
    ...options
  });
}

function characterRef(overrides = {}) {
  return {
    reference_id: "ref_char_xzn_001",
    entity_name: "萧昭宁",
    entity_type: "character",
    role: "character_reference",
    usage: "primary",
    url: "https://example.com/xzn.png",
    mime_type: "image/png",
    display_name: "萧昭宁.png",
    description: "角色参考",
    order: 1,
    ...overrides
  };
}

function sceneRef(overrides = {}) {
  return {
    reference_id: "ref_scene_camp_001",
    entity_name: "营帐",
    entity_type: "scene",
    role: "scene_reference",
    usage: "primary",
    url: "https://example.com/camp.png",
    mime_type: "image/png",
    display_name: "营帐.png",
    description: "场景参考",
    order: 2,
    ...overrides
  };
}

function propRef(overrides = {}) {
  return {
    reference_id: "ref_prop_mirror_001",
    entity_name: "铜镜",
    entity_type: "prop",
    role: "prop_reference",
    usage: "primary",
    url: "https://example.com/mirror.png",
    mime_type: "image/png",
    display_name: "铜镜.png",
    description: "道具参考",
    order: 1,
    ...overrides
  };
}

function assertNoForbidden(payload) {
  const text = JSON.stringify(payload);
  for (const field of FORBIDDEN_PUBLIC_FIELDS) {
    assert.equal(text.includes(field), false, `forbidden public field leaked: ${field}`);
  }
}

function restoreEnv(name, oldValue) {
  if (oldValue == null) delete process.env[name];
  else process.env[name] = oldValue;
}
