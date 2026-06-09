import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildReferencePlan,
  handlePromptOptimization,
  parseRagflowOptimizedPrompt,
  ragflowConfig,
  validateRagflowEnhancement
} from "../../src/routes/prompt-optimizations.js";

const root = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(root, "ai-tu/ai-image-generator.html"), "utf8");
const server = readFileSync(resolve(root, "server.js"), "utf8");
const gateway = readFileSync(resolve(root, "ai-tu/gateway/server.js"), "utf8");

test("ai-tu original page contains prompt optimizer entry and six task_type options", () => {
  assert.match(html, /帧界图片生成器快速版/);
  assert.match(html, /提示词优化/);
  assert.match(html, /id="optimizePromptBtn"/);
  assert.match(html, /id="optimizerSixTaskSamplesBtn"/);
  for (const taskType of ["text_image", "image_reference", "character_multiview", "scene_multiview", "prop_multiview", "storyboard"]) {
    assert.match(html, new RegExp(`<option value="${taskType}"`));
  }
  for (const field of ["reference_id", "entity_name", "entity_type", "role", "usage", "url", "mime_type", "display_name", "description"]) {
    assert.match(html, new RegExp(field));
  }
});

test("root service serves ai-tu page instead of independent console", () => {
  assert.match(server, /ai-tu\/ai-image-generator\.html/);
  assert.doesNotMatch(server, /src\/web/);
  assert.doesNotMatch(server, /Image API Console/);
});

test("frontend calls prompt optimizer and overwrites original prompt only on success", () => {
  assert.match(html, /fetch\("\/api\/prompt-optimizer"/);
  assert.match(html, /result\.status !== "succeeded"/);
  assert.match(html, /controls\.prompt\.value = result\.optimized_prompt/);
  assert.match(html, /controls\.prompt\.value = originalPrompt/);
});

test("frontend image job request includes structured references", () => {
  assert.match(html, /references: structuredReferences/);
  assert.match(html, /collectOptimizerReferences\(\{ requireUrl: true \}\)/);
  assert.match(html, /reference_policy:/);
  assert.match(html, /reference URL/);
  assert.match(html, /finalApiEndpoint = "\/api\/v1\/image-generations"/);
  assert.match(html, /fetch\(finalApiEndpoint/);
  assert.doesNotMatch(html, /fetch\("\/api\/image-jobs"/);
});

test("buildReferencePlan separates reference classes and generation_mode", () => {
  const refs = [
    reference("ref_scene", "古巷", "scene", "scene_reference", "primary"),
    reference("ref_char", "行人", "character", "character_reference", "auxiliary"),
    reference("ref_light", "黄昏逆光", "lighting", "lighting_reference", "auxiliary"),
    reference("ref_comp", "对称构图", "composition", "composition_reference", "auxiliary")
  ];
  const plan = buildReferencePlan({
    resolved_references: refs,
    entity_mentions: [{ entity_name: "行人", reference_status: "bound" }]
  });
  assert.equal(plan.generationMode, "image_to_image");
  assert.equal(plan.scenePrimaryRefs[0].entity_name, "古巷");
  assert.equal(plan.characterAuxiliaryRefs[0].entity_name, "行人");
  assert.equal(plan.lightingRefs[0].entity_name, "黄昏逆光");
  assert.equal(plan.compositionRefs[0].entity_name, "对称构图");
  assert.deepEqual(plan.primaryEntityNames, ["古巷"]);
  assert.deepEqual(plan.auxiliaryEntityNames, ["行人", "黄昏逆光", "对称构图"]);
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
      references: [reference("ref_poster", "海报参考", "style", "style_reference", "primary")],
      assertPrompt: (prompt) => assertImageReferencePrompt(prompt, ["海报参考"]),
      generation_mode: "image_to_image"
    },
    {
      task_type: "character_multiview",
      prompt: "生成 @云岚 的角色一致性参考图",
      references: [reference("ref_char", "云岚", "character", "character_reference", "primary")],
      assertPrompt: (prompt) => assertCharacterPrompt(prompt, "云岚"),
      generation_mode: "image_to_image"
    },
    {
      task_type: "scene_multiview",
      prompt: "生成 @茶馆 与 @掌柜 的现场光影多视角参考图",
      references: [
        reference("ref_scene", "茶馆", "scene", "scene_reference", "primary"),
        reference("ref_char", "掌柜", "character", "character_reference", "auxiliary")
      ],
      assertPrompt: (prompt) => assertScenePrompt(prompt, ["茶馆", "掌柜"]),
      generation_mode: "image_to_image"
    },
    {
      task_type: "prop_multiview",
      prompt: "生成 @铜铃 的结构和材质多角度资产图",
      references: [reference("ref_prop", "铜铃", "prop", "prop_reference", "primary")],
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
    references: [reference("ref_scene", "庭院", "scene", "scene_reference", "primary")]
  }, offlineOptions());
  assert.equal(sceneImageToImage.statusCode, 200);
  assert.equal(sceneImageToImage.payload.generation_mode, "image_to_image");
  assertScenePrompt(sceneImageToImage.payload.optimized_prompt, ["庭院"]);
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
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ visual_focus: "强调潮湿空气、树叶反光和远处暖窗光" }) } }]
    })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.match(result.payload.optimized_prompt, /潮湿空气|树叶反光|暖窗光/);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow invalid, field-summary, failure, or unauthorized enhancement is discarded", async () => {
  const badCandidates = [
    { choices: [{ message: { content: "任务类型：text_image\n原始需求：雨后森林" } }] },
    { choices: [{ message: { content: JSON.stringify({ reference_id: "unknown_ref", visual_focus: "越权引用" }) } }] },
    { code: 100, data: null, message: "internal failure" }
  ];
  for (const candidate of badCandidates) {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv(),
      fetchImpl: async () => jsonResponse(candidate)
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, "succeeded");
    assertTextImagePrompt(result.payload.optimized_prompt);
    assert.equal(result.payload.optimized_prompt.includes("越权引用"), false);
    assertNoPublicLeaks(result.payload);
  }
});

test("validateRagflowEnhancement rejects internal and unauthorized content", () => {
  const context = {
    binding: { resolved_references: [reference("ref_scene", "庭院", "scene", "scene_reference", "primary", "https://example.com/ref_scene.png")] }
  };
  assert.equal(validateRagflowEnhancement({ final_prompt: "x" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "http://bad.example/x.png" }, context), null);
  assert.equal(validateRagflowEnhancement({ reference_id: "bad_ref", visual_focus: "x" }, context), null);
  assert.deepEqual(validateRagflowEnhancement({ visual_focus: "保留庭院空间层次" }, context), { visual_focus: "保留庭院空间层次" });
});

test("RAGFlow response parser treats natural language as template guidance, not final prompt", () => {
  const parsed = parseRagflowOptimizedPrompt({
    choices: [{ message: { content: "加强冷色调现场光影和空间纵深。" } }]
  });
  assert.deepEqual(parsed, { template_guidance: "加强冷色调现场光影和空间纵深。" });
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

test("field-summary output is never returned as optimized_prompt", async () => {
  const result = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @营帐 在夜色中的现场光影多视角参考图",
    references: [reference("ref_scene", "营帐", "scene", "scene_reference", "primary")]
  }, {
    env: ragflowEnv(),
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: "任务类型：场景多视图图。\n原始需求：生成 @营帐" } }]
    })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assertScenePrompt(result.payload.optimized_prompt, ["营帐"]);
  assertNoPromptLeaks(result.payload.optimized_prompt);
});

test("scene_multiview dynamic fixtures do not bleed entities", async () => {
  const caseA = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [
      reference("ref_char", "萧昭宁", "character", "character_reference", "auxiliary"),
      reference("ref_scene", "营帐", "scene", "scene_reference", "primary")
    ]
  }, offlineOptions());
  assertScenePrompt(caseA.payload.optimized_prompt, ["营帐", "萧昭宁"]);

  const caseB = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @研究员 在 @现代实验室 中的冷色调现场光影多视角参考图",
    references: [
      reference("ref_researcher", "研究员", "character", "character_reference", "auxiliary"),
      reference("ref_lab", "现代实验室", "scene", "scene_reference", "primary")
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
    references: [reference("ref_prop", "折叠罗盘", "prop", "prop_reference", "primary")]
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
    references: [reference("ref_char", "萧昭宁", "character", "character_reference", "auxiliary")],
    reference_policy: { unbound_entity: "block" }
  }, offlineOptions());
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("gateway maps references url into existing URL image request path only", () => {
  assert.match(gateway, /rawReferences = Array\.isArray\(body\.references\)/);
  assert.match(gateway, /activeRawReferences = rawReferences\.filter/);
  assert.match(gateway, /normalizeStructuredReferenceImage/);
  assert.match(gateway, /item\.url/);
  assert.doesNotMatch(gateway, /references[\s\S]{0,400}uploadReferenceToImgbb/);
});

test("new frontend does not expose forbidden internal labels", () => {
  const visibleHtml = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
  for (const token of ["final_prompt", "compiled_prompt", "enhancement", "RAGFlow 原始输出", "fallback", "provider internal payload"]) {
    assert.equal(visibleHtml.includes(token), false, `visible forbidden token: ${token}`);
  }
});

function reference(reference_id, entity_name, entity_type, role, usage, url = `https://example.com/${reference_id}.png`, description = `${entity_name}参考图`) {
  return {
    reference_id,
    entity_name,
    entity_type,
    role,
    usage,
    url,
    mime_type: "image/png",
    display_name: `${entity_name}.png`,
    description
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
  assert.match(prompt, /人物多视角|四视图|角色设定图|人物一致性参考图/);
  assertIncludesEntity(prompt, name);
  for (const word of ["4 格横向布局", "正面全身", "头部特写", "侧面全身", "背面全身", "头到脚", "鞋子", "A 字站姿", "手上无道具", "纯色背景"]) {
    assert.match(prompt, new RegExp(word));
  }
  assert.doesNotMatch(prompt, /场景设定参考板结构|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertScenePrompt(prompt, names) {
  assert.match(prompt, /场景多视图|多机位|现场光影|场景设定参考板/);
  for (const name of names) assertIncludesEntity(prompt, name);
  for (const word of ["全景", "中景", "特写", "俯视", "平面布局", "分镜", "材质", "光影"]) {
    assert.match(prompt, new RegExp(word));
  }
  assert.doesNotMatch(prompt, /4 格横向布局|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertPropPrompt(prompt, name) {
  assert.match(prompt, /道具多视图|道具资产|多角度资产图|资产参考板/);
  assertIncludesEntity(prompt, name);
  for (const word of ["正面", "侧面", "背面", "结构", "材质", "比例", "特写"]) {
    assert.match(prompt, new RegExp(word));
  }
  assert.doesNotMatch(prompt, /角色四视图|场景设定参考板结构|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertStoryboardPrompt(prompt) {
  for (const word of ["故事板", "分镜", "剧情宫格", "左侧规划区", "右侧剧情宫格区"]) {
    assert.match(prompt, new RegExp(word));
  }
  assert.match(prompt, /不固定九宫格|不要固定九宫格/);
  assert.match(prompt, /自适应|shot 数量|宫格数量等于实际 shot 数量/);
  assert.match(prompt, /不限制 shot 数量|不限制总时长/);
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
  for (const token of ["final_prompt", "compiled_prompt", "enhancement", "RAGFlow", "fallback", "provider payload", "provider_internal_payload", "input_analysis", "storyboard_processing"]) {
    assert.equal(prompt.includes(token), false, `internal token leaked: ${token}`);
  }
}

function assertNoPublicLeaks(payload) {
  const text = JSON.stringify(payload);
  for (const token of ["final_prompt", "compiled_prompt", "enhancement", "RAGFlow", "fallback", "provider_internal_payload", "provider payload", "apiKey"]) {
    assert.equal(text.includes(token), false, `forbidden token leaked: ${token}`);
  }
}

function ragflowEnv() {
  return {
    RAGFLOW_BASE_URL: "http://ragflow.local",
    RAGFLOW_API_KEY: "test-key",
    RAGFLOW_CHAT_ID: "chat_001"
  };
}

function offlineOptions() {
  return {
    env: ragflowEnv(),
    fetchImpl: async () => jsonResponse({ code: 100, data: null, message: "offline" })
  };
}

function jsonResponse(json, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    text: async () => JSON.stringify(json)
  };
}
