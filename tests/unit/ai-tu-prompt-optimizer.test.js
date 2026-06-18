import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPromptOptimizationResponse,
  buildReferencePlan,
  callRagflowPromptOptimizer,
  handlePromptOptimization,
  parseRagflowOptimizedPrompt,
  ragflowConfig,
  validateRagflowEnhancement
} from "../../src/routes/prompt-optimizations.js";

test("buildReferencePlan separates reference classes and generation_mode", () => {
  const refs = [
    reference("ref_scene", "古巷", "scene", "scene_reference"),
    reference("ref_char", "行人", "character", "character_reference"),
    reference("ref_light", "黄昏逆光", "lighting", "lighting_reference"),
    reference("ref_comp", "对称构图", "composition", "composition_reference")
  ];
  const plan = buildReferencePlan({
    resolved_references: refs,
    entity_mentions: [{ entity_name: "行人", reference_status: "bound" }]
  });
  assert.equal(plan.generationMode, "image_to_image");
  assert.equal(plan.sceneRefs[0].entity_name, "古巷");
  assert.equal(plan.characterRefs[0].entity_name, "行人");
  assert.equal(plan.lightingRefs[0].entity_name, "黄昏逆光");
  assert.equal(plan.compositionRefs[0].entity_name, "对称构图");
  assert.deepEqual(plan.allEntityNames, ["古巷", "行人", "黄昏逆光", "对称构图"]);
});

test("six task_type requests compile deterministic optimized prompts", async () => {
  const cases = [
    {
      task_type: "text_image",
      prompt: "一座雨夜霓虹街角的电影感画面",
      references: [],
      assertPrompt: assertTextImagePrompt,
      generation_mode: "text_to_image"
    },
    {
      task_type: "image_reference",
      prompt: "基于 @海报参考 生成一张新的品牌视觉图",
      references: [reference("ref_poster", "海报参考", "style", "style_reference")],
      assertPrompt: (prompt) => assertImageReferencePrompt(prompt, ["海报参考"]),
      generation_mode: "image_to_image"
    },
    {
      task_type: "character_multiview",
      prompt: "生成 @云岚 的角色一致性参考图",
      references: [reference("ref_char", "云岚", "character", "character_reference")],
      assertPrompt: (prompt) => assertCharacterPrompt(prompt, "云岚"),
      generation_mode: "image_to_image"
    },
    {
      task_type: "scene_multiview",
      prompt: "生成 @茶馆 与 @掌柜 的现场光影多视角参考图",
      references: [
        reference("ref_scene", "茶馆", "scene", "scene_reference"),
        reference("ref_char", "掌柜", "character", "character_reference")
      ],
      assertPrompt: (prompt) => assertScenePrompt(prompt, ["茶馆", "掌柜"]),
      generation_mode: "image_to_image"
    },
    {
      task_type: "prop_multiview",
      prompt: "生成 @铜铃 的结构和材质多角度资产图",
      references: [reference("ref_prop", "铜铃", "prop", "prop_reference")],
      assertPrompt: (prompt) => assertPropPrompt(prompt, "铜铃"),
      generation_mode: "image_to_image"
    },
    {
      task_type: "storyboard",
      prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
      references: [],
      assertPrompt: assertStoryboardPrompt,
      generation_mode: "text_to_image"
    }
  ];

  for (const item of cases) {
    const result = await handlePromptOptimization({
      task_type: item.task_type,
      prompt: item.prompt,
      references: item.references,
      reference_policy: { unbound_entity: "warn" }
    }, offlineOptions());
    assert.equal(result.statusCode, 200, item.task_type);
    assert.equal(result.payload.status, "succeeded", item.task_type);
    assert.equal(result.payload.task_type, item.task_type);
    assert.equal(result.payload.generation_mode, item.generation_mode);
    assert.match(result.payload.optimization_id, /^opt_/);
    item.assertPrompt(result.payload.optimized_prompt);
    assertNoPromptLeaks(result.payload.optimized_prompt);
    assertNoPublicLeaks(result.payload);
  }
});

test("PromptOptimizationRequest schema rejects unknown and nested unsafe fields", async () => {
  const cases = [
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", output: { provider_payload: "x" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", callback: "https://client.example.com/cb" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", model: "gpt-image-2" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", provider_config: { api_key: "test" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", provider_options: { model: "gpt-image-2" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", api_key: "test-key" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", token: "test-token" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", compiled_prompt: "secret compiled prompt" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", internal_prompt: "secret internal prompt" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", base64: "abc" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", b64_json: "abc" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", data_url: "data:image/png;base64,abc" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", images: [{ url: "https://example.com/x.png" }] },
    { request_id: { value: "req_bad" }, task_type: "text_image", prompt: "生成一张山间晨雾图。" },
    { request_id: "req bad space", task_type: "text_image", prompt: "生成一张山间晨雾图。" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", reference_policy: { unbound_entity: { value: "warn" } } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", reference_policy: { unbound_entity: "ignore" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", references: [reference("ref_scene", "山雾", "scene", "scene_reference", "https://example.com/ref.png", "场景参考", { provider_payload: "x" })] },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", reference_policy: { unbound_entity: "warn", callback: "https://client.example.com/cb" } }
  ];
  for (const body of cases) {
    const result = await handlePromptOptimization(body, offlineOptions());
    assert.equal(result.statusCode, 400, JSON.stringify(body));
    assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");
    assert.equal("optimized_prompt" in result.payload, false);
    assertNoPublicLeaks(result.payload);
  }
});

test("prompt optimizer rejects sensitive consumed strings before RAGFlow fetch", async () => {
  const cases = [
    {
      task_type: "text_image",
      prompt: "请把 internal_prompt token secret 写入画面",
      references: []
    },
    {
      task_type: "image_reference",
      prompt: "基于 @海报参考 生成一张新的品牌视觉图",
      references: [reference(
        "ref_poster",
        "海报参考",
        "style",
        "style_reference",
        "https://example.com/ref_poster.png",
        "Authorization: Bearer token-123 data:image/png;base64,abc"
      )]
    },
    {
      task_type: "image_reference",
      prompt: "基于 @海报参考 生成一张新的品牌视觉图",
      references: [reference(
        "ref_poster",
        "海报参考",
        "style",
        "style_reference",
        "https://example.com/ref_poster.png",
        "compiled_prompt provider payload"
      )]
    },
    {
      task_type: "image_reference",
      prompt: "基于 @海报参考 生成一张新的品牌视觉图",
      references: [reference(
        "ref_poster",
        "海报参考",
        "style",
        "style_reference",
        "https://example.com/ref_poster.png",
        "安全描述",
        { display_name: "final_prompt.png" }
      )]
    }
  ];
  for (const body of cases) {
    let fetches = 0;
    const result = await handlePromptOptimization(body, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("must not fetch with sensitive metadata");
      }
    });
    assert.equal(result.statusCode, 400, JSON.stringify(body));
    assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");
    assert.equal(fetches, 0);
    assertNoPublicLeaks(result.payload);
  }
});

test("task_type is separated from generation_mode", async () => {
  const characterTextToImage = await handlePromptOptimization({
    task_type: "character_multiview",
    prompt: "生成一名银发医师的角色四视图设定图",
    references: []
  }, offlineOptions());
  assert.equal(characterTextToImage.statusCode, 200);
  assert.equal(characterTextToImage.payload.generation_mode, "text_to_image");
  assertCharacterPrompt(characterTextToImage.payload.optimized_prompt, "角色");

  const sceneImageToImage = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @庭院 的现场光影多视角参考图",
    references: [reference("ref_scene", "庭院", "scene", "scene_reference")]
  }, offlineOptions());
  assert.equal(sceneImageToImage.statusCode, 200);
  assert.equal(sceneImageToImage.payload.generation_mode, "image_to_image");
  assertScenePrompt(sceneImageToImage.payload.optimized_prompt, ["庭院"]);
});

test("prompt optimizer rejects text_image references like the final API contract", async () => {
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "生成 @山间晨雾。",
    references: [reference("ref_scene", "山间晨雾", "scene", "scene_reference")]
  }, offlineOptions());
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.status, "failed");
  assert.equal(result.payload.error_code, "REFERENCES_NOT_ALLOWED");
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("PromptOptimizationRequest references strict validation rejects malformed references", async () => {
  const validRef = reference("ref_scene", "山间晨雾", "scene", "scene_reference");
  const cases = [
    {
      label: "references must be array",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: { ...validRef } }
    },
    {
      label: "references max length",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: Array.from({ length: 17 }, (_, index) => reference(`ref_${index}`, `山间晨雾${index}`, "scene", "scene_reference")) }
    },
    {
      label: "reference object required",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: ["bad"] }
    },
    {
      label: "reference_id format",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, reference_id: "1bad" }] }
    },
    {
      label: "entity_name required",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, entity_name: "" }] }
    },
    {
      label: "entity_type enum",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, entity_type: "unknown_entity" }] }
    },
    {
      label: "role enum",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, role: "unknown_role" }] }
    },
    {
      label: "private URL",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, url: "http://127.0.0.1/ref.png" }] }
    },
    {
      label: "bad MIME",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, mime_type: "text/plain" }] }
    },
    {
      label: "bad order type",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, order: "1" }] }
    },
    {
      label: "bad order range",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, order: 1001 }] }
    }
  ];

  for (const { label, body } of cases) {
    const result = await handlePromptOptimization(body, offlineOptions());
    assert.equal(result.statusCode, 400, label);
    assert.equal(result.payload.status, "failed", label);
    assert.equal("optimized_prompt" in result.payload, false, label);
    assertNoPublicLeaks(result.payload);
  }
});

test("image_reference without references returns needs_clarification and does not include optimized_prompt", async () => {
  const result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于参考图生成新图",
    references: []
  }, offlineOptions());
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal(result.payload.error_code, "REFERENCE_REQUIRED");
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow enhancement can participate in deterministic compiler", async () => {
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ visual_focus: "强调潮湿空气、树叶反光和远处暖窗光" }) } }]
    })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.match(result.payload.optimized_prompt, /潮湿空气|树叶反光|暖窗光/);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow enhancement fields must be consumed by the current task before changing template path", async () => {
  const character = await handlePromptOptimization({
    task_type: "character_multiview",
    prompt: "生成 @云岚 的角色一致性参考图",
    references: [reference("ref_char", "云岚", "character", "character_reference")]
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ story_function: "未被角色任务消费的剧情功能" }) } }]
    })
  });
  assert.equal(character.statusCode, 200);
  assert.equal(character.payload.status, "succeeded");
  assert.equal(character.payload.optimized_prompt.includes("未被角色任务消费"), false);
  assert.equal(character.payload.optimized_prompt.includes("4 格横向布局"), false);
  assert.equal(character.payload.optimized_prompt.includes("头部特写"), false);

  const storyboard = await handlePromptOptimization({
    task_type: "storyboard",
    prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ normalized_shot_plan: [{ original_order: 1, core_action: "未消费分镜字段" }] }) } }]
    })
  });
  assert.equal(storyboard.statusCode, 200);
  assert.equal(storyboard.payload.status, "succeeded");
  assert.equal(storyboard.payload.optimized_prompt.includes("未消费分镜字段"), false);
  assert.equal(storyboard.payload.optimized_prompt.includes("左侧规划区"), false);
  assert.equal(storyboard.payload.optimized_prompt.includes("右侧剧情宫格区"), false);

  const textImage = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ scene_summary: "未被文生图任务消费的场景摘要" }) } }]
    })
  });
  assert.equal(textImage.payload.status, "succeeded");
  assert.equal(textImage.payload.optimized_prompt.includes("未被文生图任务消费"), false);
  assertTextImagePrompt(textImage.payload.optimized_prompt);
  assertNoPublicLeaks(character.payload);
  assertNoPublicLeaks(storyboard.payload);
  assertNoPublicLeaks(textImage.payload);
});

test("RAGFlow invalid, field-summary, failure, or unauthorized enhancement is discarded", async () => {
  const badCandidates = [
    { choices: [{ message: { content: "任务类型：text_image\n原始需求：雨后森林" } }] },
    { choices: [{ message: { content: JSON.stringify({ reference_id: "unknown_ref", visual_focus: "越权引用" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ asset_id: "asset_1", visual_focus: "越权资产" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "Authorization: Bearer token-123" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "Cookie: sid=secret" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "inline data:image/png;base64,abc" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "local file:///etc/passwd" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "ftp://evil.example/ref.png" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "javascript:alert(1)" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "blob:https://evil.example/id" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "//evil.example/ref.png" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "visit evil.example/ref.png" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ internal_prompt: "secret", visual_focus: "内部提示词" }) } }] },
    { code: 100, data: null, message: "internal failure" }
  ];
  for (const candidate of badCandidates) {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => jsonResponse(candidate)
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, "succeeded");
    assertTextImagePrompt(result.payload.optimized_prompt);
    assert.equal(result.payload.optimized_prompt.includes("越权引用"), false);
    assert.equal(result.payload.optimized_prompt.includes("越权资产"), false);
    assert.equal(result.payload.optimized_prompt.includes("Authorization"), false);
    assert.equal(result.payload.optimized_prompt.includes("Cookie"), false);
    assert.equal(result.payload.optimized_prompt.includes("data:image"), false);
    assert.equal(result.payload.optimized_prompt.includes("file://"), false);
    assert.equal(result.payload.optimized_prompt.includes("ftp://"), false);
    assert.equal(result.payload.optimized_prompt.includes("javascript:"), false);
    assert.equal(result.payload.optimized_prompt.includes("blob:"), false);
    assert.equal(result.payload.optimized_prompt.includes("evil.example"), false);
    assert.equal(result.payload.optimized_prompt.includes("内部提示词"), false);
    assertNoPublicLeaks(result.payload);
  }
});

test("validateRagflowEnhancement rejects internal and unauthorized content", () => {
  const context = {
    binding: { resolved_references: [reference("ref_scene", "庭院", "scene", "scene_reference", "https://example.com/ref_scene.png")] }
  };
  assert.equal(validateRagflowEnhancement({ final_prompt: "x" }, context), null);
  assert.equal(validateRagflowEnhancement({ internal_prompt: "x" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "https://example.com/ref_scene.png" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "http://bad.example/x.png" }, context), null);
  assert.equal(validateRagflowEnhancement({ reference_id: "bad_ref", visual_focus: "x" }, context), null);
  assert.equal(validateRagflowEnhancement({ shot_plan: [{ asset_id: "asset_1", text: "x" }] }, context), null);
  assert.equal(validateRagflowEnhancement({ template_guidance: "旧字段" }, context), null);
  assert.deepEqual(validateRagflowEnhancement({ missing_constraints: "补充用户未写明的可见约束" }, context), { missing_constraints: "补充用户未写明的可见约束" });
  assert.deepEqual(validateRagflowEnhancement({ visual_focus: "保留庭院空间层次" }, context), { visual_focus: "保留庭院空间层次" });
});

test("RAGFlow response parser discards natural language instead of treating it as a prompt", () => {
  const parsed = parseRagflowOptimizedPrompt({
    choices: [{ message: { content: "加强冷色调现场光影和空间纵深。" } }]
  });
  assert.equal(parsed, null);
});

test("RAGFlow config can be read from ai-tu runtime config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-config-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    ragflowBaseUrl: "http://ragflow.local",
    ragflowApiKey: "test-key",
    ragflowChatId: "chat_001"
  }), "utf8");
  try {
    const config = ragflowConfig({ AI_TU_RUNTIME_CONFIG_FILE: configFile });
    assert.equal(config.endpoint, "http://ragflow.local/api/v1/openai/chat_001/chat/completions");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RAGFlow config can be read from markdown runtime config notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-config-md-"));
  const configFile = join(dir, "runtime-config.md");
  writeFileSync(configFile, `${JSON.stringify({
    ragflowBaseUrl: "http://ragflow.local",
    ragflowApiKey: "test-key",
    ragflowChatId: "chat_001"
  }, null, 2)}

Local notes below the JSON object are ignored.
`, "utf8");
  try {
    const config = ragflowConfig({ AI_TU_RUNTIME_CONFIG_FILE: configFile });
    assert.equal(config.endpoint, "http://ragflow.local/api/v1/openai/chat_001/chat/completions");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RAGFlow environment variables override runtime config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-config-override-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    ragflowBaseUrl: "http://file-ragflow.local",
    ragflowApiKey: "file-key",
    ragflowChatId: "file_chat"
  }), "utf8");
  try {
    const config = ragflowConfig({
      AI_TU_RUNTIME_CONFIG_FILE: configFile,
      RAGFLOW_BASE_URL: "http://env-ragflow.local",
      RAGFLOW_API_KEY: "env-key",
      RAGFLOW_CHAT_ID: "env_chat",
      RAGFLOW_MODEL: "custom-chat-model"
    });
    assert.equal(config.endpoint, "http://env-ragflow.local/api/v1/openai/env_chat/chat/completions");
    assert.equal(config.model, "custom-chat-model");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RAGFlow URL policy rejects unsafe schemes userinfo private hosts and production misconfiguration", () => {
  const base = {
    RAGFLOW_API_KEY: "test-key",
    RAGFLOW_CHAT_ID: "chat_001"
  };
  for (const RAGFLOW_BASE_URL of [
    "file:///tmp/ragflow",
    "data:text/plain,ragflow",
    "javascript:alert(1)",
    "blob:https://example.com/id",
    "https://user:pass@ragflow.example.com",
    "http://127.0.0.1:9380",
    "http://localhost:9380",
    "http://10.0.0.1:9380",
    "http://172.16.0.1:9380",
    "http://192.168.1.2:9380",
    "http://169.254.169.254",
    "http://224.0.0.1",
    "http://240.0.0.1",
    "http://[::1]:9380",
    "http://[fe80::1]:9380",
    "http://[fc00::1]:9380",
    "http://[ff02::1]:9380",
    "http://[::ffff:127.0.0.1]:9380",
    "http://[::ffff:0.0.0.0]:9380",
    "https://ragflow.example.com/tenant-a",
    "https://ragflow.example.com?endpoint=https://evil.example",
    "https://ragflow.example.com#frag"
  ]) {
    assert.throws(() => ragflowConfig({ ...base, RAGFLOW_BASE_URL }), isRagflowConfigInvalid);
  }
  for (const RAGFLOW_BASE_URL of [
    "http://169.254.169.254",
    "http://224.0.0.1",
    "http://240.0.0.1",
    "http://[fe80::1]",
    "http://[ff02::1]"
  ]) {
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL,
      RAGFLOW_DEPLOYMENT_TIER: "test",
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }), isRagflowConfigInvalid);
  }
  assert.throws(() => ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "https://ragflow.example.com",
    RAGFLOW_DEPLOYMENT_TIER: "production"
  }), isRagflowConfigInvalid);
  assert.throws(() => ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "http://ragflow.example.com",
    RAGFLOW_DEPLOYMENT_TIER: "production",
    RAGFLOW_ALLOWED_ORIGINS: "http://ragflow.example.com"
  }), isRagflowConfigInvalid);
  assert.throws(() => ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "https://ragflow.example.com",
    RAGFLOW_DEPLOYMENT_TIER: "production",
    RAGFLOW_ALLOWED_ORIGINS: "https://other.example.com"
  }), isRagflowConfigInvalid);
  assert.equal(ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "https://ragflow.example.com",
    RAGFLOW_DEPLOYMENT_TIER: "production",
    RAGFLOW_ALLOWED_ORIGINS: "https://ragflow.example.com"
  }).endpoint, "https://ragflow.example.com/api/v1/openai/chat_001/chat/completions");
  assert.equal(ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "http://127.0.0.1:9380",
    RAGFLOW_DEPLOYMENT_TIER: "test",
    RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
  }).endpoint, "http://127.0.0.1:9380/api/v1/openai/chat_001/chat/completions");
});

test("RAGFlow private endpoint opt-in allows local dev endpoints without widening metadata ranges", async () => {
  const request = promptRequest();
  const binding = { resolved_references: [], references_used: [], entity_mentions: [] };
  const referencePlan = buildReferencePlan({ resolved_references: [] });
  let calls = 0;
  const candidate = await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({
      RAGFLOW_BASE_URL: "http://127.0.0.1:9380",
      RAGFLOW_DEPLOYMENT_TIER: "test",
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }),
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url, "http://127.0.0.1:9380/api/v1/openai/chat_001/chat/completions");
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ visual_focus: "本地知识库补充画面雾气层次" }) } }]
      });
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(candidate, { visual_focus: "本地知识库补充画面雾气层次" });

  const blockedCalls = [];
  await assert.rejects(() => callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({
      RAGFLOW_BASE_URL: "https://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER: "test",
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }),
    lookupHost: async () => [{ address: "169.254.169.254", family: 4 }],
    fetchImpl: async (url, init) => {
      blockedCalls.push({ url, authorization: init?.headers?.Authorization || "" });
      return jsonResponse({});
    }
  }), isRagflowConfigInvalid);
  assert.deepEqual(blockedCalls, []);
});

test("RAGFlow default fetch path pins validated DNS result and aborts oversized streams", async () => {
  await withRagflowServer((request, response) => {
    assert.equal(request.headers.host.startsWith("ragflow.localtest:"), true);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ visual_focus: "pinned lookup enhancement" }) } }]
    }));
  }, async ({ baseUrl }) => {
    const candidate = await callRagflowPromptOptimizer({
      request: promptRequest(),
      binding: { resolved_references: [], references_used: [], entity_mentions: [] },
      referencePlan: buildReferencePlan({ resolved_references: [] }),
      env: ragflowEnv({
        RAGFLOW_BASE_URL: baseUrl,
        RAGFLOW_DEPLOYMENT_TIER: "test",
        RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
      }),
      lookupHost: localLookup
    });
    assert.deepEqual(candidate, { visual_focus: "pinned lookup enhancement" });
  });

  await withRagflowServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    for (let index = 0; index < 128; index += 1) {
      response.write("x".repeat(1024));
    }
    response.end();
  }, async ({ baseUrl }) => {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv({
        RAGFLOW_BASE_URL: baseUrl,
        RAGFLOW_DEPLOYMENT_TIER: "test",
        RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true",
        RAGFLOW_MAX_RESPONSE_BYTES: "2048"
      }),
      lookupHost: localLookup
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, "succeeded");
    assertTextImagePrompt(result.payload.optimized_prompt);
    assertNoPublicLeaks(result.payload);
  });
});

test("RAGFlow DNS rebinding and redirects do not leak Authorization to unapproved origins", async () => {
  const request = promptRequest();
  const binding = { resolved_references: [], references_used: [], entity_mentions: [] };
  const referencePlan = buildReferencePlan({ resolved_references: [] });
  const calls = [];
  await assert.rejects(() => callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_BASE_URL: "https://ragflow.example.com" }),
    lookupHost: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async (url, init) => {
      calls.push({ url, authorization: init?.headers?.Authorization || "" });
      return jsonResponse({});
    }
  }), isRagflowConfigInvalid);
  assert.deepEqual(calls, []);

  const redirectCalls = [];
  const redirected = await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_BASE_URL: "https://ragflow.example.com" }),
    lookupHost: publicLookup,
    fetchImpl: async (url, init) => {
      redirectCalls.push({
        url,
        redirect: init.redirect,
        headers: init.headers,
        authorization: init.headers.Authorization
      });
      return {
        ok: false,
        status: 302,
        headers: {
          get: (name) => name.toLowerCase() === "location" ? "https://evil.example/steal" : null
        },
        text: async () => ""
      };
    }
  });
  assert.equal(redirected, null);
  assert.equal(redirectCalls.length, 1);
  assert.equal(redirectCalls[0].url, "https://ragflow.example.com/api/v1/openai/chat_001/chat/completions");
  assert.equal(redirectCalls[0].redirect, "manual");
  assert.equal(redirectCalls[0].authorization, "Bearer test-key");
  assert.deepEqual(Object.keys(redirectCalls[0].headers).sort(), ["Accept", "Authorization", "Content-Type"]);
  assert.equal(redirectCalls[0].headers.Accept, "application/json");
});

test("RAGFlow response resource limits discard enhancement and keep deterministic fallback", async () => {
  const cases = [
    () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/plain" : null },
      text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }] })
    }),
    () => jsonResponse({ choices: [{ message: { content: "{}" } }] }, { headers: { "content-length": String(70 * 1024) } }),
    () => jsonResponse({ nested: { a: { b: { c: { d: { e: { f: { g: { h: "too deep" } } } } } } } } }),
    () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ visual_focus: "x".repeat(5000) }) } }] }),
    () => jsonResponse({ choices: [{ message: { content: "{not-json" } }] }),
    () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }
  ];

  for (const makeResponse of cases) {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => makeResponse()
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, "succeeded");
    assertTextImagePrompt(result.payload.optimized_prompt);
    assert.equal(result.payload.optimized_prompt.includes("too deep"), false);
    assertNoPublicLeaks(result.payload);
  }
});

test("RAGFlow timeout uses AbortController signal and falls back deterministically", async () => {
  let aborted = false;
  const startedAt = Date.now();
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv({ RAGFLOW_TIMEOUT_MS: "1000" }),
    lookupHost: publicLookup,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error("timeout wiring did not abort fetch")), 2500);
      init.signal.addEventListener("abort", () => {
        clearTimeout(guard);
        aborted = true;
        const error = new Error("aborted by timeout");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  assert.equal(aborted, true);
  assert.equal(Date.now() - startedAt >= 900, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assertTextImagePrompt(result.payload.optimized_prompt);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow embedded JSON content limits and empty sanitization cannot trigger full templates", async () => {
  const deepContent = { shot_plan: [{ level1: { level2: { level3: { level4: { level5: { level6: { level7: "deep" } } } } } } }] };
  const deep = await handlePromptOptimization({
    task_type: "storyboard",
    prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
    references: []
  }, {
    env: ragflowEnv({ RAGFLOW_MAX_JSON_DEPTH: "4" }),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify(deepContent) } }]
    })
  });
  assert.equal(deep.statusCode, 200);
  assert.equal(deep.payload.status, "succeeded");
  assertStoryboardPrompt(deep.payload.optimized_prompt);
  assert.equal(deep.payload.optimized_prompt.includes("左侧规划区"), false);
  assert.equal(deep.payload.optimized_prompt.includes("右侧剧情宫格区"), false);
  assert.equal(deep.payload.optimized_prompt.includes("deep"), false);

  const emptyAfterSanitize = await handlePromptOptimization({
    task_type: "storyboard",
    prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ shot_plan: [{ asset_id: "asset_1" }] }) } }]
    })
  });
  assert.equal(emptyAfterSanitize.payload.status, "succeeded");
  assert.equal(emptyAfterSanitize.payload.optimized_prompt.includes("左侧规划区"), false);
  assert.equal(emptyAfterSanitize.payload.optimized_prompt.includes("右侧剧情宫格区"), false);
});

test("field-summary output is never returned as optimized_prompt", async () => {
  const result = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @营帐 在夜色中的现场光影多视角参考图",
    references: [reference("ref_scene", "营帐", "scene", "scene_reference")]
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: "任务类型：场景多视图图。\n原始需求：生成 @营帐" } }]
    })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assertScenePrompt(result.payload.optimized_prompt, ["营帐"]);
  assertNoPromptLeaks(result.payload.optimized_prompt);
});

test("prompt optimizer is isolated from provider store callback and image URL response fields", async () => {
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "一幅中文水墨风格的春日山谷画面",
    references: []
  }, {
    env: {
      RAGFLOW_BASE_URL: "",
      RAGFLOW_API_KEY: "",
      RAGFLOW_CHAT_ID: "",
      IMAGE_API_KEY: "",
      IMAGE_API_BASE: "",
      IMAGE_EDIT_BASE: "",
      CALLBACK_URL: "https://client.example.com/cb"
    },
    fetchImpl: async () => {
      throw new Error("prompt optimizer should not call image provider, callback, or store fetches");
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.equal("images" in result.payload, false);
  assert.equal("callback_status" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("prompt optimizer public response gate rejects nested forbidden keys and text", () => {
  const request = promptRequest();
  const context = {
    referencePlan: buildReferencePlan({}),
    binding: {
      entity_mentions: [],
      references_used: [],
      warnings: []
    }
  };
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context,
    optimizedPrompt: "生成完整高质量中文画面，但这里包含 RAGFlow 内部状态。",
    traceId: "trace_test"
  }), /公共响应包含内部信息/);
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context: {
      ...context,
      binding: {
        entity_mentions: [],
        references_used: [{ reference_id: "ref_safe", entity_name: "对象", provider_payload: "secret" }],
        warnings: []
      }
    },
    optimizedPrompt: "生成完整高质量中文画面，主体清楚，环境完整，光影稳定，细节清晰，适合直接用于图片生成。",
    traceId: "trace_test"
  }), /公共响应包含内部字段/);
});

test("local fallback does not inject full professional templates without user or knowledge source", async () => {
  const cases = [
    {
      task_type: "character_multiview",
      prompt: "生成 @云岚 的角色一致性参考图",
      references: [reference("ref_char", "云岚", "character", "character_reference")],
      forbidden: /4 格横向布局|正面全身|头部特写|侧面全身|背面全身|A 字站姿/
    },
    {
      task_type: "scene_multiview",
      prompt: "生成 @茶馆 的场景一致性参考图",
      references: [reference("ref_scene", "茶馆", "scene", "scene_reference")],
      forbidden: /3×3|等价多视图|全景镜头|中景镜头|俯视全景|平面布局图|分镜示意图/
    },
    {
      task_type: "prop_multiview",
      prompt: "生成 @铜铃 的道具一致性参考图",
      references: [reference("ref_prop", "铜铃", "prop", "prop_reference")],
      forbidden: /正面视图|侧面视图|背面视图|顶部 \/ 底部视图|结构拆解|材质特写|纹样 \/ 工艺特写/
    },
    {
      task_type: "storyboard",
      prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
      references: [],
      forbidden: /左侧规划区|右侧剧情宫格区|剧情宫格区必须|宫格数量等于实际 shot 数量/
    }
  ];
  for (const item of cases) {
    const { forbidden, ...request } = item;
    const result = await handlePromptOptimization(request, offlineOptions());
    assert.equal(result.statusCode, 200, item.task_type);
    assert.equal(result.payload.status, "succeeded", item.task_type);
    assert.doesNotMatch(result.payload.optimized_prompt, forbidden, item.task_type);
    assertNoPromptLeaks(result.payload.optimized_prompt);
    assertNoPublicLeaks(result.payload);
  }
});

test("scene_multiview dynamic fixtures do not bleed entities", async () => {
  const caseA = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [
      reference("ref_char", "萧昭宁", "character", "character_reference"),
      reference("ref_scene", "营帐", "scene", "scene_reference")
    ]
  }, offlineOptions());
  assertScenePrompt(caseA.payload.optimized_prompt, ["营帐", "萧昭宁"]);

  const caseB = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @研究员 在 @现代实验室 中的冷色调现场光影多视角参考图",
    references: [
      reference("ref_researcher", "研究员", "character", "character_reference"),
      reference("ref_lab", "现代实验室", "scene", "scene_reference")
    ]
  }, offlineOptions());
  assertScenePrompt(caseB.payload.optimized_prompt, ["现代实验室", "研究员"]);
  assert.equal(caseB.payload.optimized_prompt.includes("营帐"), false);
  assert.equal(caseB.payload.optimized_prompt.includes("萧昭宁"), false);
});

test("prop_multiview dynamic fixture does not bleed unrelated sample props", async () => {
  const result = await handlePromptOptimization({
    task_type: "prop_multiview",
    prompt: "生成 @折叠罗盘 的道具结构多视图资产图",
    references: [reference("ref_prop", "折叠罗盘", "prop", "prop_reference")]
  }, offlineOptions());
  assertPropPrompt(result.payload.optimized_prompt, "折叠罗盘");
  for (const leaked of ["青铜香炉", "机械钥匙", "营帐", "现代实验室"]) {
    assert.equal(result.payload.optimized_prompt.includes(leaked), false);
  }
});

test("prompt optimizer failure does not return optimized_prompt", async () => {
  const result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "生成 @萧昭宁 和 @营帐",
    references: [reference("ref_char", "萧昭宁", "character", "character_reference")],
    reference_policy: { unbound_entity: "block" }
  }, offlineOptions());
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

function reference(reference_id, entity_name, entity_type, role, url = `https://example.com/${reference_id}.png`, description = `${entity_name}参考图`, extra = {}) {
  return {
    reference_id,
    entity_name,
    entity_type,
    role,
    url,
    mime_type: "image/png",
    display_name: `${entity_name}.png`,
    description,
    ...extra
  };
}

function assertTextImagePrompt(prompt) {
  assert.match(prompt, /普通文字生图|完整高质量|主体明确|构图稳定/);
  assert.doesNotMatch(prompt, /4 格横向布局|场景设定参考板结构|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertImageReferencePrompt(prompt, names) {
  assert.match(prompt, /基于参考图|保持参考对象|关键视觉特征|普通参考图生图/);
  for (const name of names) assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /4 格横向布局|场景设定参考板结构|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertCharacterPrompt(prompt, name) {
  assert.match(prompt, /人物多视角|四视图|角色设定图|人物一致性参考图|角色一致性参考图|角色参考图/);
  assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /场景设定参考板结构|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertScenePrompt(prompt, names) {
  assert.match(prompt, /场景多视图|多机位|现场光影|场景设定参考板|场景一致性参考图|场景参考提示词/);
  for (const name of names) assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /4 格横向布局|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertPropPrompt(prompt, name) {
  assert.match(prompt, /道具多视图|道具资产|多角度资产图|资产参考板|道具一致性参考图|道具资产提示词/);
  assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /角色四视图|场景设定参考板结构|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertStoryboardPrompt(prompt) {
  for (const word of ["故事板", "分镜"]) {
    assert.match(prompt, new RegExp(word));
  }
  assert.match(prompt, /不固定九宫格|不要固定九宫格/);
  assert.doesNotMatch(prompt, /采用 3×3 或等价多视图/);
  assertNoPromptLeaks(prompt);
}

function assertIncludesEntity(prompt, entityName) {
  assert.ok(prompt.includes(entityName) || prompt.includes(`@${entityName}`), `missing entity ${entityName}`);
}

function assertNoPromptLeaks(prompt) {
  for (const title of [
    "任务类型：",
    "原始需求：",
    "参考绑定：",
    "优化方向：",
    "画面要求：",
    "负向约束：",
    "task_type:",
    "references:",
    "reference binding:",
    "optimization direction:",
    "negative constraints:"
  ]) {
    assert.equal(prompt.includes(title), false, `field-summary title leaked: ${title}`);
  }
  for (const token of ["final_prompt", "compiled_prompt", "internal_prompt", "enhancement", "RAGFlow", "fallback", "provider payload", "provider_internal_payload", "input_analysis", "storyboard_processing", "Authorization", "Cookie", "Bearer", "token", "secret", "base64", "data:image"]) {
    assert.equal(prompt.includes(token), false, `internal token leaked: ${token}`);
  }
}

function assertNoPublicLeaks(payload) {
  const text = JSON.stringify(payload);
  for (const token of ["final_prompt", "compiled_prompt", "internal_prompt", "enhancement", "RAGFlow", "fallback", "provider_internal_payload", "provider payload", "apiKey", "Authorization", "Cookie", "Bearer", "token", "secret", "base64", "data:image"]) {
    assert.equal(text.includes(token), false, `forbidden token leaked: ${token}`);
  }
}

function ragflowEnvWith(overrides = {}) {
  return {
    RAGFLOW_BASE_URL: "http://ragflow.local",
    RAGFLOW_API_KEY: "test-key",
    RAGFLOW_CHAT_ID: "chat_001",
    ...overrides
  };
}

function ragflowEnv(overrides = {}) {
  return ragflowEnvWith(overrides);
}

function offlineOptions() {
  return {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({ code: 100, data: null, message: "offline" })
  };
}

function jsonResponse(json, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    text: async () => JSON.stringify(json),
    headers: {
      get: (name) => {
        const headers = {
          "content-type": "application/json",
          ...(options.headers || {})
        };
        return headers[String(name || "").toLowerCase()] || null;
      }
    }
  };
}

function publicLookup() {
  return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
}

function localLookup() {
  return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
}

async function withRagflowServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    await fn({ baseUrl: `http://ragflow.localtest:${port}` });
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function promptRequest() {
  return {
    request_id: "req_test",
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: [],
    reference_policy: { unbound_entity: "warn" },
    entity_mentions: []
  };
}

function isRagflowConfigInvalid(error) {
  assert.equal(error && error.errorCode, "RAGFLOW_CONFIG_INVALID");
  return true;
}
