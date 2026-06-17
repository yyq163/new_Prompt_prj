import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleImageGeneration } from "../../src/routes/image-generations.js";
import { publicImageUrl, resolveGeneratedImagePublicBaseUrl } from "../../src/routes/image-generations.js";
import { extractEntityMentions } from "../../src/core/entity-mentions.js";
import { resolveReferences } from "../../src/core/reference-binding.js";
import { assertNoForbiddenPublicFields, assertReferenceUrlAllowed, normalizeRequest, FORBIDDEN_PUBLIC_FIELDS, TYPE_SCHEMAS } from "../../src/core/runtime.js";
import { VALID_ENTITY_TYPES, VALID_REFERENCE_ROLES } from "../../src/core/labels.js";
import { validateEnhancement, extractShotKeys } from "../../src/core/ragflow-enhancement.js";
import { compilePrompt, inferStoryboardPathForTest } from "../../src/core/prompt-compiler.js";
import { LEGACY_IMAGE_JOBS_DEPRECATION_HEADERS } from "../../src/core/legacy-api.js";
import {
  defaultProviderConfig,
  extractImageUrls,
  generateWithAiTuProvider,
  hasRequiredProviderConfig,
  longRunningSubmitConfig,
  normalizeProviderImageObject,
  normalizeProviderResult,
  fetchUpstreamOnce,
  postLiveJson,
  postLiveImageEditMultipart,
  postLiveImageUrlJson,
  assertProviderReferenceUrlAllowed,
  resolveAuthorizedFetchUrl,
  resolveAuthorizedUpstreamUrl,
  sanitizeProviderConfig
} from "../../src/providers/ai-tu-provider-adapter.js";
import {
  clearGeneratedImagesForTest,
  deleteGeneratedImage,
  getGeneratedImage,
  putGeneratedImage
} from "../../src/core/generated-image-store.js";
import { generatedImageHttpResponse } from "../../src/core/generated-image-response.js";
import { appendTrace } from "../../src/storage/trace-store.js";

const imageUrl = "https://provider.example.com/generated.png";

test("text_image without references succeeds with public response contract", async () => {
  const result = await call({
    task_type: "text_image",
    prompt: "生成一张山间晨雾图。",
    references: []
  });
  assert.equal(result.statusCode, 200);
  assertV36Success(result);
  assert.equal(result.payload.images[0].url, imageUrl);
});

test("text_image with references returns client contract error envelope", async () => {
  const result = await call({
    task_type: "text_image",
    prompt: "生成 @萧昭宁。",
    references: [characterRef()]
  });
  assertV36Error(result, "REFERENCES_NOT_ALLOWED", 400);
});

test("schema errors return client contract error envelope and no internal fields", async () => {
  const result = await call({
    task_type: "",
    prompt: "生成山水。",
    references: []
  });
  assertV36Error(result, "UNSUPPORTED_TASK_TYPE", 200, "needs_clarification");
});

test("callback_url and callback are accepted but not executed or exposed", async () => {
  let callbackFetches = 0;
  const withCallbackUrl = await call({
    task_type: "text_image",
    prompt: "生成一张山间晨雾图。",
    references: [],
    callback_url: "https://client.example.com/callback"
  }, {
    fetchImpl: async () => {
      callbackFetches += 1;
      throw new Error("callback must not execute");
    }
  });
  assert.equal(withCallbackUrl.statusCode, 200);
  assertV36Success(withCallbackUrl);
  assert.equal("callback_status" in withCallbackUrl.payload, false);
  assert.equal(JSON.stringify(withCallbackUrl.payload).includes("CALLBACK_NOT_IMPLEMENTED"), false);
  assert.equal(callbackFetches, 0);

  const withCallbackObject = normalizeRequest({
    task_type: "storyboard",
    prompt: "少女推开门。",
    callback: { url: "https://client.example.com/cb" }
  });
  assert.equal(withCallbackObject.callback_url, "https://client.example.com/cb");
});

test("callback_url rejects localhost private link-local IPv6 and unsafe schemes", () => {
  const unsafe = [
    "http://127.0.0.1:8787/cb",
    "http://localhost:8787/cb",
    "http://0.0.0.0/cb",
    "http://10.0.0.1/cb",
    "http://172.16.0.1/cb",
    "http://172.31.255.1/cb",
    "http://192.168.1.2/cb",
    "http://169.254.10.20/cb",
    "http://[::1]/cb",
    "http://[fe80::1]/cb",
    "http://[fc00::1]/cb",
    "http://[::ffff:127.0.0.1]/cb",
    "http://[::ffff:7f00:1]/cb",
    "http://2130706433/cb",
    "http://0177.0.0.1/cb",
    "file:///tmp/cb",
    "data:text/plain,cb",
    "javascript:alert(1)"
  ];
  for (const callback_url of unsafe) {
    assert.throws(() => normalizeRequest({
      task_type: "text_image",
      prompt: "生成山水。",
      callback_url
    }), /callback_url/);
  }
  assert.equal(normalizeRequest({
    task_type: "text_image",
    prompt: "生成山水。",
    callback: { url: "https://example.com/cb" }
  }).callback_url, "https://example.com/cb");
});

test("reference URL security rejects private hosts by default and allows dev override only for references", () => {
  const oldAllowLocal = process.env.ALLOW_LOCAL_REFERENCE_URLS;
  const oldPort = process.env.PORT;
  const oldHost = process.env.HOST;
  try {
    delete process.env.ALLOW_LOCAL_REFERENCE_URLS;
    process.env.PORT = "8787";
    process.env.HOST = "127.0.0.1";
    for (const url of [
      "http://127.0.0.1/ref.png",
      "http://10.0.0.1/ref.png",
      "http://172.16.1.2/ref.png",
      "http://192.168.1.2/ref.png",
      "http://169.254.1.2/ref.png",
      "http://[::1]/ref.png",
      "http://[::ffff:7f00:1]/ref.png",
      "http://2130706433/ref.png",
      "file:///tmp/ref.png"
    ]) {
      assert.throws(() => assertReferenceUrlAllowed(url), /reference\.url|http 或 https/);
    }
    assert.equal(
      assertReferenceUrlAllowed("http://127.0.0.1:8787/api/v1/generated-images/img_1234567890abcdef1234567890abcdef"),
      "http://127.0.0.1:8787/api/v1/generated-images/img_1234567890abcdef1234567890abcdef"
    );
    assert.throws(() => assertReferenceUrlAllowed("http://127.0.0.1:8787/api/v1/generated-images/not_img"), /reference\.url/);
    assert.throws(() => assertReferenceUrlAllowed("http://127.0.0.1:9999/api/v1/generated-images/img_1234567890abcdef1234567890abcdef"), /reference\.url/);
    process.env.ALLOW_LOCAL_REFERENCE_URLS = "true";
    assert.equal(assertReferenceUrlAllowed("http://127.0.0.1/ref.png"), "http://127.0.0.1/ref.png");
    assert.throws(() => normalizeRequest({
      task_type: "text_image",
      prompt: "生成山水。",
      callback_url: "http://127.0.0.1/cb"
    }), /callback_url/);
  } finally {
    restoreEnv("ALLOW_LOCAL_REFERENCE_URLS", oldAllowLocal);
    restoreEnv("PORT", oldPort);
    restoreEnv("HOST", oldHost);
  }
});

test("forbidden public field gate covers raw provider image and callback internals", () => {
  for (const field of [
    "provider_raw_payload",
    "provider_raw_response",
    "base64",
    "b64_json",
    "binary",
    "callback_status",
    "ragflow_state",
    "fallback_status"
  ]) {
    assert.throws(() => assertNoForbiddenPublicFields({ [field]: "x" }), /公共响应包含内部字段/);
  }
});

test("PUBLIC_BASE_URL controls generated image public URL and production requires it", async () => {
  const oldBase = process.env.PUBLIC_BASE_URL;
  const oldNodeEnv = process.env.NODE_ENV;
  const oldHost = process.env.HOST;
  const oldPort = process.env.PORT;
  try {
    process.env.PUBLIC_BASE_URL = "https://img.example.com///";
    assert.equal(resolveGeneratedImagePublicBaseUrl(), "https://img.example.com");
    const result = await handleImageGeneration({
      task_type: "text_image",
      prompt: "生成一张山间晨雾图。",
      references: []
    }, {
      provider: async () => ({
        status: "succeeded",
        images: [{ image_id: "img_1234567890abcdef1234567890abcdef", url: "/api/v1/generated-images/img_1234567890abcdef1234567890abcdef", width: 1, height: 1, format: "png" }]
      })
    });
    assert.equal(result.payload.images[0].url, "https://img.example.com/api/v1/generated-images/img_1234567890abcdef1234567890abcdef");
    assert.doesNotMatch(result.payload.images[0].url, /\/\/api\/v1/);
    for (const unsafeGeneratedPath of [
      "/api/v1/generated-images/../x",
      "/api/v1/generated-images/%2e%2e%2fx",
      "/api/v1/generated-images/not_img",
      "/api/v1/generated-images/img_1234567890abcdef1234567890abcdef/extra"
    ]) {
      assert.throws(() => publicImageUrl(unsafeGeneratedPath), /provider image url/);
    }

    process.env.PUBLIC_BASE_URL = "ftp://bad.example.com";
    assert.throws(() => resolveGeneratedImagePublicBaseUrl(), /PUBLIC_BASE_URL/);

    delete process.env.PUBLIC_BASE_URL;
    process.env.NODE_ENV = "production";
    assert.throws(() => resolveGeneratedImagePublicBaseUrl(), /PUBLIC_BASE_URL/);
    const missingBaseResult = await handleImageGeneration({
      task_type: "text_image",
      prompt: "生成一张山间晨雾图。",
      references: []
    }, {
      provider: async () => ({
        status: "succeeded",
        images: [{ image_id: "img_abcdefabcdefabcdefabcdefabcdefab", url: "/api/v1/generated-images/img_abcdefabcdefabcdefabcdefabcdefab", width: 1, height: 1, format: "png" }]
      })
    });
    assertV36Error(missingBaseResult, "PUBLIC_BASE_URL_REQUIRED", 500);

    process.env.NODE_ENV = "development";
    process.env.HOST = "0.0.0.0";
    process.env.PORT = "9876";
    assert.equal(resolveGeneratedImagePublicBaseUrl(), "http://127.0.0.1:9876");
  } finally {
    restoreEnv("PUBLIC_BASE_URL", oldBase);
    restoreEnv("NODE_ENV", oldNodeEnv);
    restoreEnv("HOST", oldHost);
    restoreEnv("PORT", oldPort);
  }
});

test("legacy image job API exposes deprecation boundary headers", () => {
  assert.equal(LEGACY_IMAGE_JOBS_DEPRECATION_HEADERS.Deprecation, "true");
  assert.match(LEGACY_IMAGE_JOBS_DEPRECATION_HEADERS.Warning, /Deprecated legacy image job API/);
  assert.match(LEGACY_IMAGE_JOBS_DEPRECATION_HEADERS.Link, /\/api\/v1\/image-generations/);
});

test("image_reference with references succeeds", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁 生成新图。",
    references: [characterRef()]
  });
  assertV36Success(result);
});

test("character_multiview character reference succeeds", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 的四视图。",
    references: [characterRef()]
  });
  assertV36Success(result);
  const binding = bindingFor({ task_type: "character_multiview", prompt: "生成 @萧昭宁 的四视图。", references: [characterRef()] });
  assert.equal(binding.references_used[0].role, "character_reference");
  assert.equal("usage" in binding.references_used[0], false);
});

test("character_multiview accepts face_reference", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 的四视图。",
    references: [characterRef({ role: "face_reference", entity_type: "character" })]
  });
  assertV36Success(result);
  const binding = bindingFor({ task_type: "character_multiview", prompt: "生成 @萧昭宁 的四视图。", references: [characterRef({ role: "face_reference", entity_type: "character" })] });
  assert.equal(binding.references_used[0].role, "face_reference");
});

test("character_multiview character plus scene references succeed", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的角色设定。",
    references: [characterRef(), sceneRef()]
  });
  assertV36Success(result);
  const binding = bindingFor({ task_type: "character_multiview", prompt: "生成 @萧昭宁 在 @营帐 中的角色设定。", references: [characterRef(), sceneRef()] });
  assert.equal(binding.references_used.length, 2);
});

test("scene_multiview scene plus character references succeed", async () => {
  const result = await call({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [characterRef(), sceneRef()]
  });
  assertV36Success(result);
  const binding = bindingFor({ task_type: "scene_multiview", prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图", references: [characterRef(), sceneRef()] });
  assert.equal(binding.entity_mentions.length, 2);
});

test("scene_multiview accepts lighting and composition references without scene role", async () => {
  const lighting = await call({
    task_type: "scene_multiview",
    prompt: "生成 @冷色光影 的现场光影多视角参考图",
    references: [sceneRef({ reference_id: "ref_light", entity_name: "冷色光影", entity_type: "lighting", role: "lighting_reference" })]
  });
  assertV36Success(lighting);
  const lightingBinding = bindingFor({ task_type: "scene_multiview", prompt: "生成 @冷色光影 的现场光影多视角参考图", references: [sceneRef({ reference_id: "ref_light", entity_name: "冷色光影", entity_type: "lighting", role: "lighting_reference" })] });
  assert.equal(lightingBinding.references_used[0].role, "lighting_reference");
  assert.equal(lighting.payload.warnings[0].code, "SCENE_REFERENCE_MISSING");

  const composition = await call({
    task_type: "scene_multiview",
    prompt: "生成 @对称构图 的现场光影多视角参考图",
    references: [sceneRef({ reference_id: "ref_comp", entity_name: "对称构图", entity_type: "composition", role: "composition_reference" })]
  });
  assertV36Success(composition);
  const compositionBinding = bindingFor({ task_type: "scene_multiview", prompt: "生成 @对称构图 的现场光影多视角参考图", references: [sceneRef({ reference_id: "ref_comp", entity_name: "对称构图", entity_type: "composition", role: "composition_reference" })] });
  assert.equal(compositionBinding.references_used[0].role, "composition_reference");
});

test("prop_multiview prop reference succeeds", async () => {
  const result = await call({
    task_type: "prop_multiview",
    prompt: "生成 @铜镜 的道具多视图。",
    references: [propRef()]
  });
  assertV36Success(result);
});

test("prop_multiview accepts material and ornament references", async () => {
  const material = await call({
    task_type: "prop_multiview",
    prompt: "生成 @青铜材质 的道具材质多视图。",
    references: [propRef({ reference_id: "ref_material", entity_name: "青铜材质", entity_type: "material", role: "material_reference" })]
  });
  assertV36Success(material);
  const materialBinding = bindingFor({ task_type: "prop_multiview", prompt: "生成 @青铜材质 的道具材质多视图。", references: [propRef({ reference_id: "ref_material", entity_name: "青铜材质", entity_type: "material", role: "material_reference" })] });
  assert.equal(materialBinding.references_used[0].role, "material_reference");

  const ornament = await call({
    task_type: "prop_multiview",
    prompt: "生成 @云纹装饰 的道具纹样多视图。",
    references: [propRef({ reference_id: "ref_ornament", entity_name: "云纹装饰", entity_type: "ornament", role: "ornament_reference" })]
  });
  assertV36Success(ornament);
  const ornamentBinding = bindingFor({ task_type: "prop_multiview", prompt: "生成 @云纹装饰 的道具纹样多视图。", references: [propRef({ reference_id: "ref_ornament", entity_name: "云纹装饰", entity_type: "ornament", role: "ornament_reference" })] });
  assert.equal(ornamentBinding.references_used[0].role, "ornament_reference");
});

test("character_multiview without character or face reference returns warning but succeeds", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成一名银发医师的角色四视图。",
    references: [sceneRef({ entity_name: "医馆", role: "scene_reference", entity_type: "scene" })]
  });
  assertV36Success(result);
  assert.equal(result.payload.warnings[0].code, "CHARACTER_REFERENCE_MISSING");
});

test("scene_multiview without scene reference returns warning but succeeds", async () => {
  const result = await call({
    task_type: "scene_multiview",
    prompt: "生成 @研究员 的现场光影多视角参考图。",
    references: [characterRef({ entity_name: "研究员" })]
  });
  assertV36Success(result);
  assert.equal(result.payload.warnings[0].code, "SCENE_REFERENCE_MISSING");
});

test("prop_multiview without prop material or ornament reference returns warning but succeeds", async () => {
  const result = await call({
    task_type: "prop_multiview",
    prompt: "生成一件符文器具的多角度资产图。",
    references: [sceneRef({ entity_name: "工坊", role: "scene_reference", entity_type: "scene" })]
  });
  assertV36Success(result);
  assert.equal(result.payload.warnings[0].code, "PROP_REFERENCE_MISSING");
});

test("pattern_reference is aliased to ornament_reference", () => {
  const request = normalizeRequest({
    task_type: "prop_multiview",
    prompt: "生成 @云纹 的道具纹样多视图。",
    references: [propRef({ entity_name: "云纹", entity_type: "pattern", role: "pattern_reference" })]
  });
  assert.equal(request.references[0].role, "ornament_reference");
  assert.equal(request.references[0].entity_type, "ornament");
});

test("role enum and entity_type enum accept the full PRD set", () => {
  for (const role of VALID_REFERENCE_ROLES) {
    const request = normalizeRequest({
      task_type: "image_reference",
      prompt: "参考 @对象 生成新图。",
      references: [characterRef({ reference_id: `ref_${role}`, entity_name: "对象", entity_type: "other", role })]
    });
    assert.equal(request.references[0].role, role);
  }
  for (const entityType of VALID_ENTITY_TYPES) {
    const request = normalizeRequest({
      task_type: "image_reference",
      prompt: "参考 @对象 生成新图。",
      references: [characterRef({ reference_id: `ref_${entityType}`, entity_name: "对象", entity_type: entityType, role: "style_reference" })]
    });
    assert.equal(request.references[0].entity_type, entityType);
  }
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

test("Prompt Compiler fallback does not invent professional multiview templates", () => {
  const fallbackCases = [
    {
      task_type: "character_multiview",
      prompt: "生成一名银发医师的角色设定。",
      absent: ["4 格", "4格", "头部特写", "侧面", "背面", "A 字站姿", "纯色背景"]
    },
    {
      task_type: "scene_multiview",
      prompt: "生成一座雪夜医馆的场景参考。",
      absent: ["3×3", "3x3", "多机位", "全景镜头", "平面布局图", "俯视", "分镜示意"]
    },
    {
      task_type: "prop_multiview",
      prompt: "生成一枚铜镜的道具参考。",
      absent: ["正面、侧面、背面", "正面", "侧面", "背面", "顶视", "底部结构", "材质特写", "纹样特写", "使用状态图", "比例图"]
    },
    {
      task_type: "storyboard",
      prompt: "少女推开门，看见雪夜烛火。",
      absent: ["左侧规划区", "右侧剧情宫格", "场景走位示意图", "氛围概念图", "光影变化示意"]
    }
  ];

  for (const item of fallbackCases) {
    const request = normalizeRequest({ task_type: item.task_type, prompt: item.prompt, references: [] });
    const compiled = compilePrompt({ request, binding: emptyBinding(), enhancement: null });
    for (const phrase of item.absent) {
      assert.equal(compiled.compiled_prompt.includes(phrase), false, `${item.task_type} fallback leaked ${phrase}`);
    }
  }

  const storyboard = compilePrompt({
    request: normalizeRequest({ task_type: "storyboard", prompt: "少女推开门，看见雪夜烛火。", references: [] }),
    binding: emptyBinding(),
    enhancement: null
  });
  assert.equal(storyboard.storyboard_path, "fallback_generic_storyboard_minimal");
  assert.match(storyboard.compiled_prompt, /不默认固定 shot 数量/);
  assert.match(storyboard.compiled_prompt, /不默认固定.*3×3/);
});

test("Prompt Compiler appends knowledge-driven enhancement fields including missing constraints", () => {
  const character = compilePrompt({
    request: normalizeRequest({ task_type: "character_multiview", prompt: "生成 @萧昭宁 的角色设定。", references: [characterRef()] }),
    binding: bindingFor({ task_type: "character_multiview", prompt: "生成 @萧昭宁 的角色设定。", references: [characterRef()] }),
    enhancement: {
      composition_notes: "知识库命中：四视图横向参考板，保持正侧背和头部信息一致。",
      missing_constraints: ["需要补充服饰时代边界"]
    }
  });
  assert.match(character.compiled_prompt, /四视图横向参考板/);
  assert.match(character.compiled_prompt, /missing_constraints/);
  assert.match(character.compiled_prompt, /服饰时代边界/);

  const scene = compilePrompt({
    request: normalizeRequest({ task_type: "scene_multiview", prompt: "生成 @营帐 的场景参考。", references: [sceneRef()] }),
    binding: bindingFor({ task_type: "scene_multiview", prompt: "生成 @营帐 的场景参考。", references: [sceneRef()] }),
    enhancement: {
      scene_summary: "雪夜营帐",
      composition_notes: "知识库命中：3×3 多机位空间参考板。"
    }
  });
  assert.match(scene.compiled_prompt, /3×3 多机位空间参考板/);

  const prop = compilePrompt({
    request: normalizeRequest({ task_type: "prop_multiview", prompt: "生成 @铜镜 的道具参考。", references: [propRef()] }),
    binding: bindingFor({ task_type: "prop_multiview", prompt: "生成 @铜镜 的道具参考。", references: [propRef()] }),
    enhancement: {
      visual_focus: "铜镜轮廓",
      composition_notes: "知识库命中：多角度结构、材质特写、纹样特写。"
    }
  });
  assert.match(prop.compiled_prompt, /多角度结构/);
  assert.match(prop.compiled_prompt, /材质特写/);

  const storyboardShotPlan = compilePrompt({
    request: normalizeRequest({ task_type: "storyboard", prompt: "少女推门入营。", references: [] }),
    binding: emptyBinding(),
    enhancement: {
      storyboard_processing: "script_to_storyboard",
      shot_plan: ["镜头1 推门", "镜头2 看见烛火"],
      lighting_notes: "冷暖对比"
    }
  });
  assert.equal(storyboardShotPlan.storyboard_path, "script_to_storyboard");
  assert.match(storyboardShotPlan.compiled_prompt, /镜头1 推门/);
  assert.match(storyboardShotPlan.compiled_prompt, /冷暖对比/);

  const normalized = compilePrompt({
    request: normalizeRequest({ task_type: "storyboard", prompt: "镜头1：推门\n镜头2：回头", references: [] }),
    binding: emptyBinding(),
    enhancement: {
      storyboard_processing: "normalize_shot_list",
      normalized_shot_plan: [
        { original_order: 1, core_action: "推门" },
        { original_order: 2, core_action: "回头" }
      ]
    }
  });
  assert.equal(normalized.storyboard_path, "normalized_existing_shots");
  assert.match(normalized.compiled_prompt, /"original_order":1/);
  assert.ok(normalized.compiled_prompt.indexOf("推门") < normalized.compiled_prompt.indexOf("回头"));

  const preserve = compilePrompt({
    request: normalizeRequest({ task_type: "storyboard", prompt: "完整故事板提示词，保留全部结构。", references: [] }),
    binding: emptyBinding(),
    enhancement: {
      storyboard_processing: "preserve_full_prompt",
      missing_constraints: ["知识库未命中具体布局，保留用户原文"]
    }
  });
  assert.equal(preserve.storyboard_path, "preserve_full_prompt");
  assert.match(preserve.compiled_prompt, /保留用户原文/);
});

test("RagflowEnhancement schema includes missing_constraints without public exposure", () => {
  assert.ok(TYPE_SCHEMAS.RagflowEnhancement.fields.includes("missing_constraints"));
  assert.ok(FORBIDDEN_PUBLIC_FIELDS.includes("input_analysis"));
  assert.ok(FORBIDDEN_PUBLIC_FIELDS.includes("storyboard_processing"));
  assert.ok(FORBIDDEN_PUBLIC_FIELDS.includes("storyboard_path"));
  assert.ok(FORBIDDEN_PUBLIC_FIELDS.includes("enhancement"));
});

test("usage field is accepted but ignored and never returned", () => {
  const request = normalizeRequest({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁 生成新图。",
    references: [characterRef({ usage: "primary" })]
  });
  const binding = resolveReferences(request, extractEntityMentions(request.prompt));
  assert.equal("usage" in binding.resolved_references[0], false);
  assert.equal("usage" in binding.references_used[0], false);
});

test("RAGFlow missing/failing enhancement still succeeds with local compiler and provider", async () => {
  const old = process.env.RAGFLOW_ENHANCEMENT_URL;
  process.env.RAGFLOW_ENHANCEMENT_URL = "http://127.0.0.1:1/nope";
  const result = await call({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [characterRef(), sceneRef()]
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

test("RAGFlow output compiled_prompt is discarded", () => {
  const request = normalizeRequest({ task_type: "storyboard", prompt: "剧情段落", references: [] });
  const validation = validateEnhancement(JSON.stringify({ compiled_prompt: "secret" }), { request, binding: { resolved_references: [] } });
  assert.equal(validation.enhancement, null);
  assert.equal(validation.discarded, "prompt_leak");
});

test("RAGFlow unauthorized reference_id is discarded", () => {
  const request = normalizeRequest({ task_type: "image_reference", prompt: "参考 @萧昭宁", references: [characterRef()] });
  const binding = resolveReferences(request, extractEntityMentions(request.prompt));
  const validation = validateEnhancement({ reference_id: "ref_other" }, { request, binding });
  assert.equal(validation.enhancement, null);
  assert.equal(validation.discarded, "reference_emitted");
});

test("RAGFlow may not emit any reference id URL or unknown enhancement fields", () => {
  const request = normalizeRequest({ task_type: "image_reference", prompt: "参考 @萧昭宁", references: [characterRef()] });
  const binding = resolveReferences(request, extractEntityMentions(request.prompt));
  const knownUrl = binding.resolved_references[0].url;
  const cases = [
    [{ reference_id: "ref_char" }, "reference_emitted"],
    [{ reference_ids: ["ref_char"] }, "reference_emitted"],
    [{ composition_notes: `match ${knownUrl}` }, "url_emitted"],
    [{ composition_notes: "inline data:image/png;base64,abc" }, "url_emitted"],
    [{ composition_notes: "local file:///tmp/reference.png" }, "url_emitted"],
    [{ composition_notes: "remote ftp://example.com/reference.png" }, "url_emitted"],
    [{ template_guidance: "not allowed" }, "unknown_field"]
  ];

  for (const [enhancement, discarded] of cases) {
    const validation = validateEnhancement(enhancement, { request, binding });
    assert.equal(validation.enhancement, null);
    assert.equal(validation.discarded, discarded);
  }
});

test("RAGFlow binding decision semantics are discarded", () => {
  const request = normalizeRequest({ task_type: "character_multiview", prompt: "参考 @萧昭宁", references: [characterRef()] });
  const binding = resolveReferences(request, extractEntityMentions(request.prompt));
  const cases = [
    { composition_notes: "Use ref_x as primary reference and ref_y as auxiliary." },
    { composition_notes: "把 ref_x 作为主参考，ref_y 作为辅参考。" },
    { composition_notes: "按 0.8 权重处理第一张参考图。" },
    { reference_weight: { ref_x: 0.8 } },
    { priority: ["ref_x"] }
  ];

  for (const enhancement of cases) {
    const validation = validateEnhancement(enhancement, { request, binding });
    assert.equal(validation.enhancement, null);
    assert.equal(validation.discarded, "binding_decision");
  }
});

test("RAGFlow unauthorized URL non JSON array and internal negative notes are discarded", () => {
  const request = normalizeRequest({ task_type: "image_reference", prompt: "参考 @萧昭宁", references: [characterRef()] });
  const binding = resolveReferences(request, extractEntityMentions(request.prompt));

  assert.deepEqual(
    validateEnhancement({ composition_notes: "see https://unknown.example.com/a.png" }, { request, binding }),
    { enhancement: null, discarded: "url_emitted" }
  );
  assert.deepEqual(
    validateEnhancement("not-json", { request, binding }),
    { enhancement: null, discarded: "non_json" }
  );
  assert.deepEqual(
    validateEnhancement([{ composition_notes: "array is invalid" }], { request, binding }),
    { enhancement: null, discarded: "not_object" }
  );
  assert.deepEqual(
    validateEnhancement({ negative_notes: "不要暴露 compiled_prompt 或 fallback 状态" }, { request, binding }),
    { enhancement: null, discarded: "internal_terms" }
  );
});

test("RAGFlow internal implementation terms are discarded across enhancement fields", () => {
  const request = normalizeRequest({ task_type: "storyboard", prompt: "剧情段落", references: [] });
  const binding = { resolved_references: [] };
  const cases = [
    { composition_notes: "Do not mention RAGFlow retrieval state." },
    { visual_focus: "避免暴露本地模板处理。" },
    { missing_constraints: ["不要输出 fallback 状态。"] },
    { nested: { note: "provider_internal_payload must stay hidden." } },
    { nested: { note: "compiled_prompt should not be exposed." } },
    { nested: { note: "final_prompt should not be exposed." } }
  ];

  for (const enhancement of cases) {
    assert.deepEqual(
      validateEnhancement(enhancement, { request, binding }),
      { enhancement: null, discarded: "internal_terms" }
    );
  }
});

test("duplicate reference_id fails", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [characterRef(), characterRef()]
  });
  assertV36Error(result, "DUPLICATE_REFERENCE_ID", 400);
});

test("same entity and role multiple references all bind successfully", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [
      characterRef({ reference_id: "ref_a" }),
      characterRef({ reference_id: "ref_b", url: "https://example.com/b.png" })
    ]
  });
  assertV36Success(result);
  const binding = bindingFor({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [
      characterRef({ reference_id: "ref_a" }),
      characterRef({ reference_id: "ref_b", url: "https://example.com/b.png" })
    ]
  });
  assert.deepEqual(binding.entity_mentions[0].matched_reference_ids, ["ref_a", "ref_b"]);
  assert.equal(binding.references_used.length, 2);
});

test("unmentioned references are still included in references_used", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [
      characterRef({ reference_id: "ref_a" }),
      sceneRef({ reference_id: "ref_scene_unmentioned", entity_name: "营帐" })
    ]
  });
  assertV36Success(result);
  const binding = bindingFor({
    task_type: "image_reference",
    prompt: "参考 @萧昭宁",
    references: [
      characterRef({ reference_id: "ref_a" }),
      sceneRef({ reference_id: "ref_scene_unmentioned", entity_name: "营帐" })
    ]
  });
  assert.deepEqual(binding.references_used.map((item) => item.reference_id), ["ref_a", "ref_scene_unmentioned"]);
});

test("strict role entity and output schema reject invalid values", () => {
  assert.throws(() => normalizeRequest({
    task_type: "image_reference",
    prompt: "参考 @对象",
    references: [characterRef({ role: "pattern_reference_old_bad" })]
  }), /参考图 role 不合法/);
  assert.throws(() => normalizeRequest({
    task_type: "image_reference",
    prompt: "参考 @对象",
    references: [characterRef({ entity_type: "unknown_entity" })]
  }), /reference\.entity_type 不合法/);
  assert.throws(() => normalizeRequest({ task_type: "text_image", prompt: "生成山水。", output: { count: 5 } }), /output\.count/);
  assert.throws(() => normalizeRequest({ task_type: "text_image", prompt: "生成山水。", output: { aspect_ratio: "2:3" } }), /output\.aspect_ratio/);
  assert.throws(() => normalizeRequest({ task_type: "text_image", prompt: "生成山水。", output: { quality: "ultra" } }), /output\.quality/);
  assert.throws(() => normalizeRequest({ task_type: "text_image", prompt: "生成山水。", output: { language: "fr-FR" } }), /output\.language/);
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

test("unbound_entity block returns V3.6 fixed failure envelope", async () => {
  const result = await call({
    task_type: "image_reference",
    prompt: "生成 @萧昭宁 和 @营帐。",
    references: [characterRef()],
    reference_policy: { unbound_entity: "block" }
  });
  assertV36Error(result, "ENTITY_REFERENCE_NOT_FOUND", 200, "needs_clarification");
});

test("provider base64-only response is converted to generated image URL without public leakage", () => {
  clearGeneratedImagesForTest();
  const images = extractImageUrls({ data: [{ b64_json: samplePngBase64(), mime_type: "image/png" }] });
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(images[0].format, "png");
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");

  const nakedImageImages = extractImageUrls({ data: [{ image: samplePngBase64(), mime_type: "image/png" }] });
  assert.equal(nakedImageImages.length, 1);
  assert.match(nakedImageImages[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);

  const nakedResultImages = extractImageUrls({ data: [{ result: samplePngBase64(), mime_type: "image/png" }] });
  assert.equal(nakedResultImages.length, 1);
  assert.match(nakedResultImages[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);

  const outputImages = extractImageUrls({ output: [{ type: "image_generation_call", result: samplePngBase64() }] });
  assert.equal(outputImages.length, 1);
  assert.match(outputImages[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(outputImages).includes(samplePngBase64()), false);

  for (const key of ["base64", "image_base64", "data_url"]) {
    const value = key === "data_url" ? `data:image/png;base64,${samplePngBase64()}` : samplePngBase64();
    const images = extractImageUrls({ data: [{ [key]: value, mime_type: "image/png" }] });
    assert.equal(images.length, 1, key);
    assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/, key);
    assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png", key);
    assert.equal(JSON.stringify(images).includes(samplePngBase64()), false, key);
    assert.equal(JSON.stringify(images).includes("data:image"), false, key);
  }

  for (const key of ["b64_json", "base64", "image_base64", "data_url"]) {
    const value = key === "data_url" ? `data:image/png;base64,${samplePngBase64()}` : samplePngBase64();
    const images = extractImageUrls({ [key]: value, mime_type: "image/png" });
    assert.equal(images.length, 1, `top-level ${key}`);
    assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/, `top-level ${key}`);
    assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png", `top-level ${key}`);
    assert.equal(JSON.stringify(images).includes(samplePngBase64()), false, `top-level ${key}`);
    assert.equal(JSON.stringify(images).includes("data:image"), false, `top-level ${key}`);
  }
});

test("gpt-image-2 edits b64_json response becomes URL and provider error without image remains failure", async () => {
  clearGeneratedImagesForTest();
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    apiKey: "test-key",
    requestTimeoutSeconds: 10
  }));
  const request = {
    model: "gpt-image-2",
    prompt: "生成参考图",
    n: 1,
    output_format: "png",
    images: [{ image_url: "https://example.com/ref.png" }]
  };

  const images = await postLiveImageEditMultipart(request, config, async (_url, init) => {
    if (!init || !init.method) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => samplePngBytes(),
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ b64_json: samplePngBase64(), mime_type: "image/png" }] }),
      headers: { get: () => "application/json" }
    };
  });
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");
  assert.equal(JSON.stringify(images).includes("b64_json"), false);
  assert.equal(JSON.stringify(images).includes(samplePngBase64()), false);

  await assert.rejects(() => postLiveImageEditMultipart(request, config, async (_url, init) => {
    if (!init || !init.method) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => samplePngBytes(),
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        error: { message: "provider rejected request" }
      }),
      headers: { get: () => "application/json" }
    };
  }), /provider 返回错误/);
});

test("provider URL response mapper accepts url, image_url, and output_url", () => {
  const images = extractImageUrls({
    data: [
      { url: "https://provider.example.com/a.png", width: 100 },
      { image_url: "https://provider.example.com/b.webp", height: 120 },
      { output_url: "https://provider.example.com/c.jpeg" },
      { image_url: { url: "https://provider.example.com/d.png" } },
      { content: [{ image_url: { url: "https://provider.example.com/e.webp" } }] },
      { image: "https://provider.example.com/f.jpeg" },
      { result: "https://provider.example.com/g.png" }
    ]
  });
  assert.deepEqual(images.map((item) => item.url).sort(), [
    "https://provider.example.com/a.png",
    "https://provider.example.com/b.webp",
    "https://provider.example.com/c.jpeg",
    "https://provider.example.com/d.png",
    "https://provider.example.com/e.webp",
    "https://provider.example.com/f.jpeg",
    "https://provider.example.com/g.png"
  ].sort());
});

test("provider chat-style text content image links are accepted only when image-shaped", () => {
  const images = extractImageUrls({
    choices: [{
      message: {
        content: "done: https://provider.example.com/generated/result.webp?sig=redacted"
      }
    }]
  });
  assert.equal(images.length, 1);
  assert.equal(images[0].url, "https://provider.example.com/generated/result.webp?sig=redacted");
  assert.equal(images[0].format, "webp");

  assert.throws(() => extractImageUrls({
    choices: [{
      message: {
        content: "done: https://provider.example.com/generated/result"
      }
    }]
  }), /没有找到可访问的图片 URL/);
});

test("provider URL response with forbidden raw or encoded fields is rejected", async () => {
  const payloads = [
    { data: [{ url: "https://provider.example.com/a.png", b64_json: samplePngBase64() }] },
    { images: [{ url: "https://provider.example.com/a.png", final_prompt: "must not be accepted" }] },
    { images: [{ url: "https://provider.example.com/a.png", provider_internal_payload: { id: "raw" } }] },
    { images: [{ url: "https://provider.example.com/a.png", provider_payload: { id: "raw" } }] },
    { images: [{ url: "https://provider.example.com/a.png", provider_raw_response: { id: "raw" } }] },
    { images: [{ url: "https://provider.example.com/a.png", data: { url: "https://provider.example.com/raw.png" } }] }
  ];

  for (const payload of payloads) {
    assert.throws(() => extractImageUrls(payload), /不允许透传/);
  }
});

test("provider image extraction tolerates metadata-heavy encoded image variants", async () => {
  clearGeneratedImagesForTest();
  const urlSafeNoPadding = samplePngBase64()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const images = extractImageUrls({
    created: 123,
    usage: { total_tokens: 1 },
    data: [{
      b64_json: `\n${urlSafeNoPadding}\n`,
      mime_type: "image/jpeg",
      revised_prompt: "safe metadata"
    }]
  });

  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");

  const oldBase = process.env.PUBLIC_BASE_URL;
  try {
    process.env.PUBLIC_BASE_URL = "https://img.example.com";
    const result = await handleImageGeneration({
      task_type: "text_image",
      prompt: "生成一张山间晨雾图。",
      references: []
    }, {
      provider: async () => ({ status: "succeeded", images })
    });
    assertV36Success(result);
    const publicText = JSON.stringify(result.payload);
    assert.equal(publicText.includes(urlSafeNoPadding), false);
    assert.equal(publicText.includes("final_prompt"), false);
    assert.equal(publicText.includes("raw"), false);
    assert.equal(publicText.includes("usage"), false);
  } finally {
    restoreEnv("PUBLIC_BASE_URL", oldBase);
  }
});

test("public API rejects unsafe provider-returned external image URLs", async () => {
  for (const url of [
    "http://127.0.0.1/private.png",
    "http://10.0.0.1/private.png",
    "http://172.16.0.1/private.png",
    "http://192.168.1.2/private.png",
    "http://169.254.1.2/private.png",
    "http://[::1]/private.png",
    "http://[fe80::1]/private.png",
    "file:///tmp/private.png"
  ]) {
    const result = await handleImageGeneration({
      task_type: "text_image",
      prompt: "生成一张山间晨雾图。",
      references: []
    }, {
      provider: async () => ({
        status: "succeeded",
        images: [{ image_id: "img_unsafe", url, width: 1, height: 1, format: "png" }]
      })
    });
    assert.equal(result.payload.status, "failed", url);
    assertV36Error(result, "PROMPT_IMAGE_BACKEND_INVALID_RESPONSE");
  }
});

test("shared provider image URL sanitizer protects legacy and final route callers", () => {
  assert.equal(publicImageUrl("https://cdn.example.com/generated.png"), "https://cdn.example.com/generated.png");
  assert.throws(() => publicImageUrl("http://127.0.0.1/private.png"), /provider image url/);
  assert.throws(() => publicImageUrl("file:///tmp/private.png"), /provider image url/);
});

test("provider data URL response is converted to generated image URL", () => {
  clearGeneratedImagesForTest();
  const images = extractImageUrls({
    data: [{ image: `data:image/png;base64,${samplePngBase64()}`, width: 64, height: 64 }]
  });
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(images[0].width, 64);
  assert.equal(images[0].height, 64);
  assert.equal(JSON.stringify(images).includes("data:image"), false);
});

test("provider binary buffer response is converted to generated image URL", () => {
  clearGeneratedImagesForTest();
  const dataUrlImages = extractImageUrls(`data:image/png;base64,${samplePngBase64()}`);
  assert.equal(dataUrlImages.length, 1);
  assert.match(dataUrlImages[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);

  const directBufferImages = extractImageUrls(samplePngBytes(), "png");
  assert.equal(directBufferImages.length, 1);
  assert.match(directBufferImages[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);

  const directTypedImages = extractImageUrls(new Uint8Array(samplePngBytes()), "png");
  assert.equal(directTypedImages.length, 1);
  assert.match(directTypedImages[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);

  const wrapped = normalizeProviderImageObject({
    binary: samplePngBytes(),
    mime_type: "image/png",
    width: 64,
    height: 64
  }, "png");
  assert.match(wrapped.url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(wrapped.width, 64);
  assert.equal(wrapped.height, 64);
  assert.equal(getGeneratedImage(wrapped.image_id).mime, "image/png");

  const direct = normalizeProviderImageObject(samplePngBytes(), "png");
  assert.match(direct.url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(direct.image_id).mime, "image/png");

  for (const value of [
    samplePngArrayBuffer(),
    new Uint8Array(samplePngBytes()),
    new Int8Array(samplePngBytes())
  ]) {
    const item = normalizeProviderImageObject(value, "png");
    assert.match(item.url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
    assert.equal(getGeneratedImage(item.image_id).mime, "image/png");
  }
});

test("provider direct binary HTTP image response is converted to generated image URL", async () => {
  let observedInit = null;
  const json = await fetchUpstreamOnce("https://provider.example.com/v1/images/generations", {
    method: "POST",
    headers: {}
  }, async (_url, init) => {
    observedInit = init;
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null },
      arrayBuffer: async () => samplePngArrayBuffer()
    };
  }, {
    baseUrl: "https://provider.example.com/v1/images/generations",
    requestTimeoutSeconds: 10
  });
  assert.equal(observedInit.redirect, "manual");
  const images = extractImageUrls(json);
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");
});

test("provider direct binary HTTP image response is accepted by postLiveJson", async () => {
  clearGeneratedImagesForTest();
  const images = await postLiveJson("https://provider.example.com/v1/images/generations", {
    model: "gpt-image-2",
    prompt: "生成图片",
    n: 1,
    format: "png"
  }, async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null },
    arrayBuffer: async () => samplePngArrayBuffer()
  }), providerPollConfig());
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");
});

test("provider JSON body is recovered when stream terminates after a complete payload", async () => {
  clearGeneratedImagesForTest();
  const encoder = new TextEncoder();
  const payload = JSON.stringify({
    data: [{ b64_json: samplePngBytes().toString("base64"), mime_type: "image/png" }]
  });
  let readCount = 0;
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    body: {
      getReader: () => ({
        async read() {
          readCount += 1;
          if (readCount === 1) return { done: false, value: encoder.encode(payload) };
          throw new Error("terminated");
        },
        releaseLock() {}
      })
    }
  };

  const images = await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, () => postLiveJson("https://provider.example.com/v1/images/generations", {
    model: "gpt-image-2",
    prompt: "生成山间晨雾。",
    n: 1,
    size: "1024x1024",
    format: "png"
  }, async () => response));

  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");
});

test("text generation provider JSON uses documented gpt-image-2 format contract", async () => {
  const calls = [];
  const longCompiledPrompt = "山间晨雾".repeat(260);
  await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, () => generateWithAiTuProvider({
    request: normalizeRequest({
      task_type: "text_image",
      prompt: "生成山间晨雾。",
      references: [],
      output: { count: 1, aspect_ratio: "1:1", quality: "high", return_format: "url", language: "zh-CN" }
    }),
    compiledPrompt: longCompiledPrompt,
    fetchImpl: providerFetchRecorder(calls)
  }));

  const submit = calls.find((call) => call.kind === "submit");
  assert.equal(submit.url, "https://provider.example.com/v1/images/generations");
  assert.deepEqual(Object.keys(submit.body).sort(), ["format", "model", "n", "prompt", "quality", "size"]);
  assert.deepEqual(submit.headers, {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    Authorization: "Bearer test-key",
    Connection: "close",
    "Content-Type": "application/json"
  });
  assert.equal(submit.body.model, "gpt-image-2");
  assert.equal(submit.body.n, 1);
  assert.equal(submit.body.size, "1024x1024");
  assert.equal(submit.body.quality, "high");
  assert.equal(submit.body.format, "png");
  assert.equal(submit.body.prompt.length <= 1000, true);
  assert.equal("output_format" in submit.body, false);
  assert.equal("image" in submit.body, false);
  assert.equal("images" in submit.body, false);
  assert.equal("response_format" in submit.body, false);
  assert.equal("style" in submit.body, false);
  assertNoForbiddenModel(submit.body);
});

test("generated image store supports put get delete cleanup and TTL", () => {
  clearGeneratedImagesForTest();
  const stored = putGeneratedImage({ bytes: samplePngBytes(), mime: "image/png", ttlMs: 1000 });
  assert.match(stored.id, /^img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(stored.id).mime, "image/png");
  assert.equal(deleteGeneratedImage(stored.id), true);
  assert.equal(getGeneratedImage(stored.id), null);

  const expired = putGeneratedImage({ bytes: samplePngBytes(), mime: "image/png", ttlMs: 1000 });
  const item = getGeneratedImage(expired.id);
  item.expiresAt = Date.now() - 1;
  assert.equal(getGeneratedImage(expired.id), null);
});

test("generated image store accepts real PNG JPEG and WEBP bytes without weakening validation", () => {
  clearGeneratedImagesForTest();
  for (const [bytes, mime, format] of [
    [samplePngBytes(), "image/png", "png"],
    [sampleJpegBytes(), "image/jpeg", "jpeg"],
    [sampleWebpBytes(), "image/webp", "webp"]
  ]) {
    const stored = putGeneratedImage({ bytes, mime });
    const record = getGeneratedImage(stored.id);
    assert.equal(record.mime, mime);
    assert.equal(record.format, format);
    assert.equal(record.bytes.equals(bytes), true);
  }
});

test("provider encoded and binary JPEG WEBP payloads become generated image URLs", () => {
  clearGeneratedImagesForTest();
  const jpeg = extractImageUrls({ data: [{ b64_json: sampleJpegBytes().toString("base64"), mime_type: "image/jpeg" }] });
  assert.equal(jpeg.length, 1);
  assert.match(jpeg[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(jpeg[0].image_id).mime, "image/jpeg");

  const webp = extractImageUrls({ data: [{ binary: sampleWebpBytes(), mime_type: "image/webp" }] });
  assert.equal(webp.length, 1);
  assert.match(webp[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(getGeneratedImage(webp[0].image_id).mime, "image/webp");
});

test("generated image route response metadata returns correct content headers and 404", () => {
  clearGeneratedImagesForTest();
  const stored = putGeneratedImage({ bytes: samplePngBytes(), mime: "image/png", ttlMs: 1000 });
  const ok = generatedImageHttpResponse(stored.id);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["Content-Type"], "image/png");
  assert.equal(ok.headers["Content-Length"], String(samplePngBytes().length));
  assert.equal(ok.headers["Cache-Control"], "no-store");
  assert.equal(ok.body.equals(samplePngBytes()), true);

  const missing = generatedImageHttpResponse("img_missing");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers["Cache-Control"], "no-store");
});

test("generated image store rejects fake image headers", () => {
  clearGeneratedImagesForTest();
  assert.throws(() => putGeneratedImage({
    bytes: fakePngHeaderBytes(),
    mime: "image/png"
  }), /不是支持的图片格式/);
  assert.throws(() => putGeneratedImage({
    bytes: fakePngSkeletonBytes(),
    mime: "image/png"
  }), /不是支持的图片格式/);
  assert.throws(() => putGeneratedImage({
    bytes: fakeJpegHeaderBytes(),
    mime: "image/jpeg"
  }), /不是支持的图片格式/);
  assert.throws(() => putGeneratedImage({
    bytes: fakeJpegSoiEoiBytes(),
    mime: "image/jpeg"
  }), /不是支持的图片格式/);
  assert.throws(() => putGeneratedImage({
    bytes: fakeWebpHeaderBytes(),
    mime: "image/webp"
  }), /不是支持的图片格式/);
  assert.throws(() => putGeneratedImage({
    bytes: fakeWebpEmptyVp8Bytes(),
    mime: "image/webp"
  }), /不是支持的图片格式/);
});

test("provider encoded image payloads return PROVIDER_RESPONSE_UNSUPPORTED", () => {
  assert.throws(() => extractImageUrls({ data: [{ b64_json: "not-valid-base64***" }] }), /base64 图片格式非法/);
  assert.throws(() => normalizeProviderImageObject({
    b64_json: Buffer.from("not-an-image").toString("base64"),
    mime_type: "image/gif"
  }, "gif"), /不是支持的图片格式/);
  assert.throws(() => extractImageUrls({
    data: [
      { b64_json: "not-valid-base64***" },
      { url: "https://provider.example.com/valid.png" }
    ]
  }), /base64 图片格式非法/);
  assert.throws(() => extractImageUrls({
    data: [
      { image: "not-valid-base64***" },
      { url: "https://provider.example.com/valid.png" }
    ]
  }), /base64 图片格式非法/);
  assert.throws(() => extractImageUrls({
    data: [
      { result: "not-valid-base64***" },
      { url: "https://provider.example.com/valid.png" }
    ]
  }), /base64 图片格式非法/);
  assert.throws(() => putGeneratedImage({
    bytes: sampleGifBytes(),
    mime: "image/gif"
  }), /不是支持的图片格式/);
  const storedMismatchedMime = putGeneratedImage({
    bytes: samplePngBytes(),
    mime: "image/jpeg"
  });
  assert.equal(storedMismatchedMime.mime, "image/png");
  assert.throws(() => putGeneratedImage({
    bytes: samplePngBytes(),
    mime: "image/png",
    maxBytes: 4
  }), /超过大小限制/);
});

test("public API encoded image failures do not leak raw provider payload", async () => {
  const cases = [
    { data: [{ b64_json: "not-valid-base64***" }] },
    { data: [{ b64_json: Buffer.from("not-an-image").toString("base64"), mime_type: "image/png" }] }
  ];
  for (const payload of cases) {
    const result = await handleImageGeneration({
      task_type: "text_image",
      prompt: "生成一张山间晨雾图。",
      references: []
    }, {
      provider: async () => ({
        status: "succeeded",
        images: extractImageUrls(payload)
      })
    });
    assertV36Error(result, "PROMPT_IMAGE_BACKEND_INVALID_RESPONSE");
    assert.deepEqual(result.payload.images, []);
    const publicText = JSON.stringify(result.payload);
    assert.equal(publicText.includes("not-valid-base64"), false);
    assert.equal(publicText.includes(Buffer.from("not-an-image").toString("base64")), false);
    assert.equal(publicText.includes("b64_json"), false);
    assert.equal(publicText.includes("base64"), false);
    assert.equal(publicText.includes("data:image"), false);
    assert.equal(publicText.includes("provider_raw_response"), false);
  }
});

test("plain provider result text is not treated as base64 image", () => {
  assert.throws(() => extractImageUrls({ result: "task completed without image bytes" }), /没有找到可访问的图片/);
});

test("public API converts provider base64 to generated URL and never exposes encoded bytes", async () => {
  const oldBase = process.env.PUBLIC_BASE_URL;
  try {
    process.env.PUBLIC_BASE_URL = "https://img.example.com";
  const result = await handleImageGeneration({
    task_type: "text_image",
    prompt: "生成一张山间晨雾图。",
    references: []
  }, {
    provider: async () => ({
      status: "succeeded",
      images: extractImageUrls({ data: [{ b64_json: samplePngBase64(), mime_type: "image/png" }] })
    })
  });
    assert.equal(result.statusCode, 200);
    assertV36Success(result);
    assert.match(result.payload.images[0].url, /^https:\/\/img\.example\.com\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(result.payload).includes(samplePngBase64()), false);
    assert.equal(JSON.stringify(result.payload).includes("b64_json"), false);
    assert.equal(JSON.stringify(result.payload).includes("data:image"), false);
  assert.equal(JSON.stringify(result.payload).includes("provider_internal_payload"), false);
  assertNoForbidden(result.payload);
  } finally {
    restoreEnv("PUBLIC_BASE_URL", oldBase);
  }
});

test("long-running image submit waits beyond relay completion time and does not retry non-idempotent generation", async () => {
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    apiKey: "test-key",
    requestTimeoutSeconds: 180,
    retryAttempts: 5
  }));
  assert.equal(config.requestTimeoutSeconds >= 600, true);
  assert.equal(config.retryAttempts, 1);

  let calls = 0;
  await assert.rejects(() => postLiveImageEditMultipart({
    model: "gpt-image-2",
    prompt: "生成参考图",
    n: 1,
    size: "1024x1024",
    quality: "high",
    output_format: "png",
    images: [{ image_url: "https://example.com/ref.png" }]
  }, {
    ...config,
    requestTimeoutSeconds: 10
  }, async (url, init) => {
    if (!init || !init.method) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => samplePngBytes(),
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
      };
    }
    calls += 1;
    return {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => JSON.stringify({ message: "upstream busy" }),
      headers: { get: () => null }
    };
  }), /图片生成 provider 调用失败|请求失败/);
  assert.equal(calls, 1);
});

test("image edit multipart uses fixed edits endpoint image array field filename MIME prompt and no unsupported knobs", async () => {
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    apiKey: "test-key",
    requestTimeoutSeconds: 10
  }));
  let submittedUrl = "";
  let submittedBody = null;
  await postLiveImageEditMultipart({
    model: "gpt-image-2",
    prompt: "生成参考图",
    n: 3,
    size: "1024x1024",
    quality: "standard",
    output_format: "png",
    images: [{ image_url: "https://example.com/ref.png" }]
  }, config, async (url, init) => {
    if (!init || !init.method) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => samplePngBytes(),
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
      };
    }
    submittedUrl = String(url);
    submittedBody = await summarizeProviderRequestBody(init.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ b64_json: samplePngBase64(), mime_type: "image/png" }] }),
      headers: { get: () => "application/json" }
    };
  });
  assert.equal(new URL(submittedUrl).pathname, "/v1/images/edits");
  assert.equal(submittedBody.model, "gpt-image-2");
  assert.equal(submittedBody.prompt, "生成参考图");
  assert.equal(submittedBody.imageCount, 1);
  assert.deepEqual(submittedBody.imageFieldNames, ["image[]"]);
  assert.deepEqual(submittedBody.imageFileNames, ["ref.png"]);
  assert.deepEqual(submittedBody.imageMimeTypes, ["image/png"]);
  assert.equal("n" in submittedBody, false);
  assert.equal("size" in submittedBody, false);
  assert.equal("quality" in submittedBody, false);
  assert.equal("response_format" in submittedBody, false);
  assert.equal("background" in submittedBody, false);
  assert.equal("mask" in submittedBody, false);
  assertNoForbiddenModel(submittedBody);
});

test("image edit multipart sends every valid reference as image array file", async () => {
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    apiKey: "test-key",
    requestTimeoutSeconds: 10
  }));
  let submittedBody = null;
  await postLiveImageEditMultipart({
    model: "gpt-image-2",
    prompt: "生成双参考图",
    n: 1,
    output_format: "png",
    images: [
      { image_url: "https://example.com/ref-one.png" },
      { image_url: "https://example.com/ref two.jpeg" }
    ]
  }, config, async (url, init) => {
    if (!init || !init.method) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => samplePngBytes(),
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
      };
    }
    submittedBody = await summarizeProviderRequestBody(init.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ b64_json: samplePngBase64(), mime_type: "image/png" }] }),
      headers: { get: () => "application/json" }
    };
  });
  assert.equal(submittedBody.imageCount, 2);
  assert.deepEqual(submittedBody.imageFieldNames, ["image[]", "image[]"]);
  assert.deepEqual(submittedBody.imageFileNames, ["ref-one.png", "ref_20two.jpeg"]);
  assert.deepEqual(submittedBody.imageMimeTypes, ["image/png", "image/png"]);
});

test("image URL transport uses configured generation endpoint reference_images contract", async () => {
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    imageTransport: "url",
    apiKey: "test-key",
    requestTimeoutSeconds: 10
  }));
  const calls = [];
  await postLiveImageUrlJson({
    model: "gpt-image-2",
    prompt: "URL 模式生成",
    n: 1,
    aspect_ratio: "1:1",
    output_format: "png",
    images: [{ image_url: "https://i.example.com/ref.png" }]
  }, config, async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "", body: init?.body ? JSON.parse(init.body) : null });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ url: imageUrl }] }),
      headers: { get: () => "application/json" }
    };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://provider.example.com/v1/images/generations");
  assert.equal(calls[0].body.model, "gpt-image-2");
  assert.equal(calls[0].body.size, "1:1");
  assert.equal(calls[0].body.resolution, "1K");
  assert.equal(calls[0].body.response_format, "url");
  assert.deepEqual(calls[0].body.reference_images, ["https://i.example.com/ref.png"]);
  assert.equal("format" in calls[0].body, false);
  assert.equal("image" in calls[0].body, false);
  assert.equal("image_urls" in calls[0].body, false);
  assert.equal("client_business_id" in calls[0].body, false);
});

test("real provider adapter keeps reference-backed URL transport on configured generation endpoint", async () => {
  const calls = [];
  await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    imageTransport: "url",
    apiKey: "test-key"
  }, () => generateWithAiTuProvider({
    request: normalizeRequest({
      task_type: "image_reference",
      prompt: "参考 @海报 生成新图。",
      references: [sceneRef({ entity_name: "海报" })],
      output: { count: 1, aspect_ratio: "1:1", quality: "high", return_format: "url", language: "zh-CN" }
    }),
    compiledPrompt: "compiled prompt",
    fetchImpl: providerFetchRecorder(calls)
  }));
  const submitCalls = calls.filter((call) => call.kind === "submit");
  assert.equal(submitCalls.length, 1);
  assert.equal(submitCalls[0].url, "https://provider.example.com/v1/images/generations");
  assert.equal(submitCalls[0].body.model, "gpt-image-2");
  assert.deepEqual(submitCalls[0].body.reference_images, ["https://example.com/camp.png"]);
  assert.equal(calls.some((call) => call.kind === "provider-image"), true);
});

test("real provider adapter uses ToAPIs URL transport payload for text generations", async () => {
  clearGeneratedImagesForTest();
  const calls = [];
  const result = await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    imageTransport: "url",
    apiKey: "test-key"
  }, () => generateWithAiTuProvider({
    request: normalizeRequest({
      task_type: "text_image",
      prompt: "生成山间晨雾。",
      references: [],
      output: { count: 1, aspect_ratio: "16:9", quality: "high", return_format: "url", language: "zh-CN" }
    }),
    compiledPrompt: "compiled prompt",
    fetchImpl: providerFetchRecorder(calls)
  }));
  assert.equal(calls[0].url, "https://provider.example.com/v1/images/generations");
  assert.equal(calls[0].body.model, "gpt-image-2");
  assert.equal(calls[0].body.size, "16:9");
  assert.equal(calls[0].body.resolution, "1K");
  assert.equal(calls[0].body.response_format, "url");
  assert.equal("format" in calls[0].body, false);
  assert.equal("reference_images" in calls[0].body, false);
  assert.equal("client_business_id" in calls[0].body, false);
  assert.equal(calls[1].kind, "provider-image");
  assert.equal(calls[1].url, imageUrl);
  assert.match(result.images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
  const storedId = result.images[0].url.split("/").pop();
  assert.equal(getGeneratedImage(storedId).mime, "image/png");
  assert.equal(generatedImageHttpResponse(storedId).headers["Cache-Control"], "no-store");
});

test("image edit multipart rejects requests with no usable reference URL before upstream submit", async () => {
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key",
    requestTimeoutSeconds: 10
  }));
  let submitCount = 0;
  await assert.rejects(() => postLiveImageEditMultipart({
    model: "gpt-image-2",
    prompt: "生成参考图",
    n: 1,
    output_format: "png",
    images: [{ image_url: "   " }, { url: "" }]
  }, config, async (_url, init) => {
    if (init && init.method) submitCount += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ b64_json: samplePngBase64(), mime_type: "image/png" }] }),
      headers: { get: () => "application/json" }
    };
  }), /图生图需要至少一张参考图 URL/);
  assert.equal(submitCount, 0);
});

test("image edit reference fetch rejects oversized or non-image reference responses", async () => {
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key",
    requestTimeoutSeconds: 10
  }));
  const request = {
    model: "gpt-image-2",
    prompt: "生成参考图",
    n: 1,
    size: "1024x1024",
    quality: "high",
    output_format: "png",
    images: [{ image_url: "https://example.com/ref.png" }]
  };
  const oldMaxBytes = process.env.REFERENCE_IMAGE_MAX_BYTES;
  try {
    process.env.REFERENCE_IMAGE_MAX_BYTES = "16";
    await assert.rejects(() => postLiveImageEditMultipart(request, config, async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => samplePngBytes(),
      headers: { get: (name) => name.toLowerCase() === "content-length" ? "64" : "image/png" }
    })), /参考图超过/);

    process.env.REFERENCE_IMAGE_MAX_BYTES = "1048576";
    await assert.rejects(() => postLiveImageEditMultipart(request, config, async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from("not an image"),
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
    })), /支持的 png、jpeg 或 webp/);

    await assert.rejects(() => postLiveImageEditMultipart(request, config, async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => samplePngBytes(),
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/jpeg" : null }
    })), /MIME 类型与图片字节不匹配/);
  } finally {
    restoreEnv("REFERENCE_IMAGE_MAX_BYTES", oldMaxBytes);
  }
});

test("provider async response polls internally and returns URL without exposing running state", async () => {
  const calls = [];
  const images = await normalizeProviderResult({ task_id: "task_001" }, "png", async (url, init) => {
    calls.push({ url, authorization: init?.headers?.Authorization || "" });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ url: "https://provider.example.com/async.png" }] }),
      headers: { get: () => null }
    };
  }, {
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
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
  assert.equal(calls[0].url, "https://provider.example.com/v1/tasks/task_001");
  assert.equal(calls[0].authorization, "Bearer test-key");
});

test("provider poll URL allowlist rejects third-party local private and malformed URLs before Authorization fetch", async () => {
  const blocked = [
    { status_url: "https://evil.example/poll" },
    { status_url: "//evil.example/v1/tasks/task_001" },
    { status_url: "file:///tmp/task_001" },
    { status_url: "javascript:alert(1)" },
    { status_url: "https://user:pass@provider.example.com/v1/tasks/task_001" },
    { poll_url: "http://localhost:9999/v1/tasks/task_001" },
    { poll_url: "http://127.0.0.1:9999/poll" },
    { poll_url: "http://10.0.0.5/v1/tasks/task_001" },
    { poll_url: "http://172.16.0.5/v1/tasks/task_001" },
    { poll_url: "http://192.168.1.5/v1/tasks/task_001" },
    { poll_url: "http://169.254.169.254/v1/tasks/task_001" },
    { poll_url: "http://[::1]:9999/v1/tasks/task_001" },
    { poll_url: "http://[fe80::1]/v1/tasks/task_001" },
    { poll_url: "http://[fc00::1]/v1/tasks/task_001" },
    { poll_url: "http://2130706433/v1/tasks/task_001" },
    { poll_url: "http://0177.0.0.1/v1/tasks/task_001" },
    { poll_url: "http://0.0.0.0/v1/tasks/task_001" },
    { poll_url: "http://[::ffff:127.0.0.1]/v1/tasks/task_001" },
    { pollUrl: "not a url with spaces" },
    { statusUrl: "https://provider.example.com/not-v1/task_001" }
  ];

  for (const payload of blocked) {
    const calls = [];
    await assert.rejects(() => normalizeProviderResult(payload, "png", async (url, init) => {
      calls.push({ url, authorization: init?.headers?.Authorization || "" });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ url: "https://provider.example.com/async.png" }] }),
        headers: { get: () => null }
      };
    }, providerPollConfig()), /provider poll url/);
    assert.deepEqual(calls, [], JSON.stringify(payload));
  }
});

test("provider poll URL allowlist allows same-origin absolute and relative poll paths", async () => {
  const allowedCases = [
    {
      payload: { status_url: "https://provider.example.com/v1/tasks/task_001" },
      expectedUrl: "https://provider.example.com/v1/tasks/task_001"
    },
    {
      payload: { poll_url: "/v1/tasks/task_002" },
      expectedUrl: "https://provider.example.com/v1/tasks/task_002"
    },
    {
      payload: { pollUrl: "v1/tasks/task_003" },
      expectedUrl: "https://provider.example.com/v1/tasks/task_003"
    },
    {
      payload: { pollUrl: "task_004" },
      expectedUrl: "https://provider.example.com/v1/tasks/task_004"
    },
    {
      payload: { pollUrl: "./task_005" },
      expectedUrl: "https://provider.example.com/v1/tasks/task_005"
    }
  ];

  for (const item of allowedCases) {
    const calls = [];
    const images = await normalizeProviderResult(item.payload, "png", async (url, init) => {
      calls.push({ url, authorization: init?.headers?.Authorization || "" });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ url: "https://provider.example.com/async.png" }] }),
        headers: { get: () => null }
      };
    }, providerPollConfig());
    assert.deepEqual(images.map((image) => image.url), ["https://provider.example.com/async.png"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, item.expectedUrl);
    assert.equal(calls[0].authorization, "Bearer test-key");
  }
});

test("provider poll URL rejection public response does not leak raw URL Authorization or key", async () => {
  const result = await handleImageGeneration({
    task_type: "text_image",
    prompt: "生成山水。",
    references: [],
    output: { count: 1, aspect_ratio: "1:1", quality: "high" }
  }, {
    provider: async ({ fetchImpl }) => {
      await normalizeProviderResult({ status_url: "https://evil.example/poll?token=secret" }, "png", fetchImpl, providerPollConfig());
      return { status: "succeeded", images: [] };
    },
    fetchImpl: async () => {
      throw new Error("unsafe poll URL must not be fetched");
    }
  });
  assertV36Error(result, "PROMPT_IMAGE_BACKEND_INVALID_RESPONSE");
  const publicText = JSON.stringify(result.payload);
  assert.equal(publicText.includes("evil.example"), false);
  assert.equal(publicText.includes("Authorization"), false);
  assert.equal(publicText.includes("test-key"), false);
  assert.equal(publicText.includes("secret"), false);
});

test("resolveAuthorizedUpstreamUrl rejects unsafe poll URL shapes", () => {
  const config = providerPollConfig();
  assert.equal(resolveAuthorizedUpstreamUrl("https://provider.example.com/v1/tasks/task_001", config), "https://provider.example.com/v1/tasks/task_001");
  assert.equal(resolveAuthorizedUpstreamUrl("/v1/tasks/task_001", config), "https://provider.example.com/v1/tasks/task_001");
  assert.equal(resolveAuthorizedUpstreamUrl("task_001", config), "https://provider.example.com/v1/tasks/task_001");
  assert.equal(resolveAuthorizedUpstreamUrl("./task_002", config), "https://provider.example.com/v1/tasks/task_002");
  assert.throws(() => resolveAuthorizedUpstreamUrl("https://evil.example/v1/tasks/task_001", config), /provider poll url/);
  assert.throws(() => resolveAuthorizedUpstreamUrl("http://127.0.0.1:9999/v1/tasks/task_001", config), /provider poll url/);
  assert.throws(() => resolveAuthorizedUpstreamUrl("http://2130706433/v1/tasks/task_001", config), /provider poll url/);
  assert.throws(() => resolveAuthorizedUpstreamUrl("http://0177.0.0.1/v1/tasks/task_001", config), /provider poll url/);
  assert.throws(() => resolveAuthorizedUpstreamUrl("http://[::ffff:127.0.0.1]/v1/tasks/task_001", config), /provider poll url/);
  assert.throws(() => resolveAuthorizedUpstreamUrl("//evil.example/v1/tasks/task_001", config), /provider poll url/);
  assert.throws(() => resolveAuthorizedUpstreamUrl("https://user:pass@provider.example.com/v1/tasks/task_001", config), /provider poll url/);
  assert.throws(() => resolveAuthorizedUpstreamUrl("https://provider.example.com/not-v1/task_001", config), /provider poll url/);
});

test("configured provider submit endpoints are separated from provider-returned poll URL allowlist", () => {
  const config = providerPollConfig();
  assert.equal(resolveAuthorizedFetchUrl(config.baseUrl, config), "https://provider.example.com/v1/images/generations");
  assert.equal(resolveAuthorizedFetchUrl(config.imageEditUrl, config), "https://provider.example.com/v1/images/edits");
  assert.equal(resolveAuthorizedFetchUrl("https://provider.example.com/v1/tasks/task_001", config), "https://provider.example.com/v1/tasks/task_001");
  assert.throws(() => resolveAuthorizedFetchUrl("https://evil.example/v1/tasks/task_001", config), /provider poll url/);

  const localSubmitConfig = {
    ...config,
    baseUrl: "http://127.0.0.1:18080/v1/images/generations",
    imageEditUrl: "http://127.0.0.1:18080/v1/images/edits"
  };
  assert.equal(resolveAuthorizedFetchUrl(localSubmitConfig.baseUrl, localSubmitConfig), localSubmitConfig.baseUrl);
  assert.equal(resolveAuthorizedFetchUrl(localSubmitConfig.imageEditUrl, localSubmitConfig), localSubmitConfig.imageEditUrl);
  assert.throws(() => resolveAuthorizedFetchUrl("http://127.0.0.1:18080/v1/tasks/task_001", localSubmitConfig), /provider poll url/);
});

test("provider submit endpoints reject self-recursive base URLs", () => {
  const oldHost = process.env.HOST;
  const oldPort = process.env.PORT;
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "8787";
  try {
    for (const baseUrl of [
      "http://127.0.0.1:8787/v1/images/generations",
      "http://localhost:8787/v1/images/generations",
      "http://[::1]:8787/v1/images/generations"
    ]) {
      assert.throws(() => sanitizeProviderConfig({
        baseUrl,
        imageEditUrl: "https://provider.example.com/v1/images/edits",
        apiKey: "test-key"
      }), /provider endpoint|自身服务|递归/);
    }
    assert.throws(() => sanitizeProviderConfig({
      baseUrl: "https://provider.example.com/v1/images/generations",
      imageEditUrl: "http://127.0.0.1:8787/v1/images/edits",
      apiKey: "test-key"
    }), /provider endpoint|自身服务|递归/);
  } finally {
    restoreEnv("HOST", oldHost);
    restoreEnv("PORT", oldPort);
  }
});

test("real provider adapter fixes text generation endpoint and model regardless of config models", async () => {
  const calls = [];
  const result = await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    apiKey: "test-key"
  }, () => generateWithAiTuProvider({
    request: normalizeRequest({
      task_type: "text_image",
      prompt: "生成山间晨雾。",
      references: []
    }),
    compiledPrompt: "compiled prompt",
    fetchImpl: providerFetchRecorder(calls)
  }));

  assert.equal(result.status, "succeeded");
  const submit = calls.find((call) => call.kind === "submit");
  assert.equal(calls.filter((call) => call.kind === "submit").length, 1);
  assert.equal(submit.url, "https://provider.example.com/v1/images/generations");
  assert.equal(submit.body.model, "gpt-image-2");
  assert.equal("image" in submit.body, false);
  assertNoForbiddenModel(submit.body);
  assert.equal(calls.find((call) => call.kind === "provider-image").url, imageUrl);
  assert.match(result.images[0].url, /^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/);
});

test("real provider adapter ignores forbidden configured model names in payload", async () => {
  for (const forbiddenModel of ["gpt-image-2-all", "gpt-image-1", "dall-e-3"]) {
    const calls = [];
    const result = await withTempProviderConfig({
      baseUrl: "https://provider.example.com/v1/images/generations",
      imageEditUrl: "https://provider.example.com/v1/images/edits",
      model: forbiddenModel,
      imageModel: forbiddenModel,
      apiKey: "test-key"
    }, () => generateWithAiTuProvider({
      request: normalizeRequest({
        task_type: "text_image",
        prompt: "生成山间晨雾。",
        references: []
      }),
      compiledPrompt: "compiled prompt",
      fetchImpl: providerFetchRecorder(calls)
    }));

    assert.equal(result.status, "succeeded");
    const submit = calls.find((call) => call.kind === "submit");
    assert.equal(submit.body.model, "gpt-image-2");
    assertNoForbiddenModel(submit.body);
  }
});

test("real provider adapter keeps reference-backed URL transport on generations endpoint and gpt-image-2", async () => {
  const cases = [
    ["image_reference", "参考 @萧昭宁 生成新图。", [characterRef()]],
    ["character_multiview", "生成 @萧昭宁 的角色设定。", [characterRef()]],
    ["scene_multiview", "生成 @营帐 的场景参考。", [sceneRef()]],
    ["prop_multiview", "生成 @铜镜 的道具参考。", [propRef()]],
    ["storyboard", "参考 @萧昭宁 生成故事板。", [characterRef()]]
  ];

  for (const [task_type, prompt, references] of cases) {
    const calls = [];
    const result = await withTempProviderConfig({
      baseUrl: "https://provider.example.com/v1/images/generations",
      imageEditUrl: "https://provider.example.com/v1/images/generations",
      imageTransport: "url",
      model: "gpt-image-2",
      imageModel: "gpt-image-2",
      apiKey: "test-key"
    }, () => generateWithAiTuProvider({
      request: normalizeRequest({
        task_type,
        prompt,
        references
      }),
      compiledPrompt: "compiled prompt",
      fetchImpl: providerFetchRecorder(calls)
    }));

    assert.equal(result.status, "succeeded");
    const submit = calls.find((call) => call.kind === "submit");
    assert.equal(submit.url, "https://provider.example.com/v1/images/generations", `${task_type} used wrong endpoint`);
    assert.equal(submit.body.model, "gpt-image-2", `${task_type} used wrong model`);
    assert.deepEqual(submit.body.reference_images, references.map((item) => item.url));
    assert.equal("imageCount" in submit.body, false);
    assert.match(submit.headers["Content-Type"], /application\/json/);
    assertNoForbiddenModel(submit.body);
  }
});

test("provider adapter reference fetch rejects private urls even when called outside route normalization", async () => {
  assert.throws(() => assertProviderReferenceUrlAllowed("http://127.0.0.1/private.png"), /默认不允许/);
  assert.throws(() => assertProviderReferenceUrlAllowed("http://10.0.0.5/private.png"), /默认不允许/);
  assert.equal(assertProviderReferenceUrlAllowed("https://provider.example.com/reference.png"), "https://provider.example.com/reference.png");

  await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, async () => {
    let fetched = false;
    await assert.rejects(() => postLiveImageEditMultipart({
      model: "gpt-image-2",
      prompt: "compiled prompt",
      n: 1,
      size: "1024x1024",
      output_format: "png",
      images: [{ url: "http://127.0.0.1/private.png" }]
    }, defaultProviderConfig(), async () => {
      fetched = true;
      throw new Error("fetch should not run");
    }), /默认不允许/);
    assert.equal(fetched, false);
  });

  await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, async () => {
    const calls = [];
    await assert.rejects(() => postLiveImageEditMultipart({
      model: "gpt-image-2",
      prompt: "compiled prompt",
      n: 1,
      size: "1024x1024",
      output_format: "png",
      images: [{ url: "https://provider.example.com/redirect.png" }]
    }, defaultProviderConfig(), async (url, init) => {
      calls.push({ url, redirect: init?.redirect || "", method: init?.method || "" });
      return {
        ok: false,
        status: 302,
        headers: { get: (name) => name.toLowerCase() === "location" ? "http://127.0.0.1/private.png" : null },
        arrayBuffer: async () => Buffer.alloc(0)
      };
    }), /参考图地址无法被生图服务访问/);
    assert.deepEqual(calls, [{
      url: "https://provider.example.com/redirect.png",
      redirect: "manual",
      method: ""
    }]);
  });
});

test("real provider adapter keeps storyboard without references on generations endpoint", async () => {
  const calls = [];
  await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    apiKey: "test-key"
  }, () => generateWithAiTuProvider({
    request: normalizeRequest({
      task_type: "storyboard",
      prompt: "少女推开门，看见雪夜烛火。",
      references: []
    }),
    compiledPrompt: "compiled prompt",
    fetchImpl: providerFetchRecorder(calls)
  }));

  assert.equal(calls[0].url, "https://provider.example.com/v1/images/generations");
  assert.equal(calls[0].body.model, "gpt-image-2");
  assert.equal("image" in calls[0].body, false);
  assertNoForbiddenModel(calls[0].body);
});

test("real provider adapter derives reference payload from references instead of trusting generation_mode", async () => {
  const withReferencesCalls = [];
  await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    imageTransport: "url",
    apiKey: "test-key"
  }, () => generateWithAiTuProvider({
    request: {
      ...normalizeRequest({
        task_type: "image_reference",
        prompt: "参考 @萧昭宁 生成新图。",
        references: [characterRef()]
      }),
      generation_mode: "text_to_image"
    },
    compiledPrompt: "compiled prompt",
    fetchImpl: providerFetchRecorder(withReferencesCalls)
  }));
  const withReferencesSubmit = withReferencesCalls.find((call) => call.kind === "submit");
  assert.equal(withReferencesSubmit.url, "https://provider.example.com/v1/images/generations");
  assert.deepEqual(withReferencesSubmit.body.reference_images, ["https://example.com/xzn.png"]);

  const noReferenceCalls = [];
  await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, () => generateWithAiTuProvider({
    request: {
      ...normalizeRequest({
        task_type: "storyboard",
        prompt: "少女推开门，看见雪夜烛火。",
        references: []
      }),
      generation_mode: "image_to_image"
    },
    compiledPrompt: "compiled prompt",
    fetchImpl: providerFetchRecorder(noReferenceCalls)
  }));
  const noReferenceSubmit = noReferenceCalls.find((call) => call.kind === "submit");
  assert.equal(noReferenceSubmit.url, "https://provider.example.com/v1/images/generations");
  assert.equal(noReferenceSubmit.body.model, "gpt-image-2");
  assert.equal("image" in noReferenceSubmit.body, false);
});

test("generated image store URL works only as a full structured reference for image_to_image", async () => {
  const oldHost = process.env.HOST;
  const oldPort = process.env.PORT;
  try {
    process.env.HOST = "127.0.0.1";
    process.env.PORT = "8787";
    clearGeneratedImagesForTest();
    const stored = putGeneratedImage({
      bytes: samplePngBytes(),
      mime: "image/png",
      source: "unit_reference_upload"
    });
    const localUrl = `http://127.0.0.1:8787${stored.path}`;
    const captured = {};
    const structured = await handleImageGeneration({
      task_type: "image_reference",
      prompt: "参考 @本地参考图 生成新图。",
      references: [{
        reference_id: "ref_local_upload",
        entity_name: "本地参考图",
        entity_type: "other",
        role: "style_reference",
        url: localUrl
      }],
      reference_policy: { unbound_entity: "warn" },
      output: { count: 1, aspect_ratio: "1:1", quality: "high" }
    }, {
      provider: async ({ request }) => {
        captured.generationMode = request.generation_mode;
        captured.referenceUrl = request.references[0].url;
        return {
          status: "succeeded",
          images: [{ image_id: "img_001", url: imageUrl, width: 1024, height: 1024, format: "png" }]
        };
      }
    });
    assert.equal(structured.statusCode, 200);
    assertV36Success(structured);
    assert.equal(captured.generationMode, "image_to_image");
    assert.equal(captured.referenceUrl, localUrl);

    const urlOnly = await handleImageGeneration({
      task_type: "image_reference",
      prompt: "参考 @本地参考图 生成新图。",
      references: [{ url: localUrl }],
      output: { count: 1, aspect_ratio: "1:1", quality: "high" }
    });
    assert.equal(urlOnly.payload.status, "failed");
    assertV36Error(urlOnly, "INVALID_REQUEST_SCHEMA", 400);
  } finally {
    restoreEnv("HOST", oldHost);
    restoreEnv("PORT", oldPort);
    clearGeneratedImagesForTest();
  }
});

test("Final API exposes text provider failures without mock success or internals", async () => {
  const result = await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, () => handleImageGeneration({
    task_type: "text_image",
    prompt: "生成山间晨雾。",
    references: [],
    output: { count: 1, aspect_ratio: "1:1", quality: "high" }
  }, {
    provider: generateWithAiTuProvider,
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => JSON.stringify({ message: "upstream busy" }),
      headers: { get: () => null }
    })
  }));

  assert.equal(result.statusCode, 502);
  assertV36Error(result, "PROMPT_IMAGE_BACKEND_UNAVAILABLE");
  assert.deepEqual(result.payload.error.backend_call_summary, {
    stage: "provider_submit",
    endpoint_kind: "generations",
    upstream_status: 502,
    provider_error_code: "upstream_failed",
    retryable: true
  });
  assertNoUnsafeBackendCallSummary(result.payload);
});

test("Final API classifies terminated generations submit as upstream 502 without fake image URL", async () => {
  const result = await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, () => handleImageGeneration({
    task_type: "text_image",
    prompt: "生成山间晨雾。",
    references: [],
    output: { count: 1, aspect_ratio: "1:1", quality: "high" }
  }, {
    provider: generateWithAiTuProvider,
    fetchImpl: async () => {
      throw new Error("terminated");
    }
  }));

  assert.equal(result.statusCode, 502);
  assertV36Error(result, "PROMPT_IMAGE_BACKEND_UNAVAILABLE");
  assert.match(result.payload.error.message, /上游.*502|请求终止|未生成图片/);
  assert.deepEqual(result.payload.images, []);
  assert.deepEqual(result.payload.error.backend_call_summary, {
    stage: "provider_submit",
    endpoint_kind: "generations",
    upstream_status: 502,
    provider_error_code: "upstream_terminated",
    retryable: true
  });
  assertNoUnsafeBackendCallSummary(result.payload);
});

test("Final API exposes image provider failures without mock success or internals", async () => {
  const oldHost = process.env.HOST;
  const oldPort = process.env.PORT;
  try {
    process.env.HOST = "127.0.0.1";
    process.env.PORT = "8787";
    clearGeneratedImagesForTest();
    const stored = putGeneratedImage({
      bytes: samplePngBytes(),
      mime: "image/png",
      source: "unit_reference_upload"
    });
    const localUrl = `http://127.0.0.1:8787${stored.path}`;
    let submitCount = 0;
    const result = await withTempProviderConfig({
      baseUrl: "https://provider.example.com/v1/images/generations",
      imageEditUrl: "https://provider.example.com/v1/images/edits",
      apiKey: "test-key"
    }, () => handleImageGeneration({
      task_type: "image_reference",
      prompt: "参考 @本地参考图 生成新图。",
      references: [{
        reference_id: "ref_local_upload",
        entity_name: "本地参考图",
        entity_type: "other",
        role: "style_reference",
        url: localUrl
      }],
      reference_policy: { unbound_entity: "warn" },
      output: { count: 1, aspect_ratio: "1:1", quality: "high" }
    }, {
      provider: generateWithAiTuProvider,
      fetchImpl: async (url, init) => {
        if (!init || !init.method) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => samplePngBytes(),
            headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
          };
        }
        submitCount += 1;
        return {
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
          text: async () => JSON.stringify({ message: "upstream busy" }),
          headers: { get: () => null }
        };
      }
    }));

    assert.equal(submitCount, 1);
    assert.equal(result.statusCode, 502);
    assertV36Error(result, "PROMPT_IMAGE_BACKEND_UNAVAILABLE");
    assert.deepEqual(result.payload.error.backend_call_summary, {
      stage: "provider_submit",
      endpoint_kind: "edits",
      upstream_status: 502,
      provider_error_code: "upstream_failed",
      retryable: true
    });
    assertNoUnsafeBackendCallSummary(result.payload);
  } finally {
    restoreEnv("HOST", oldHost);
    restoreEnv("PORT", oldPort);
    clearGeneratedImagesForTest();
  }
});

test("provider 200 error object maps to redacted backend-call-summary", async () => {
  const result = await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, () => handleImageGeneration({
    task_type: "text_image",
    prompt: "生成山间晨雾。",
    references: [],
    output: { count: 1, aspect_ratio: "1:1", quality: "high" }
  }, {
    provider: generateWithAiTuProvider,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: { code: "rate_limit_exceeded", message: "secret token raw endpoint" } }),
      headers: { get: () => "application/json" }
    })
  }));

  assert.equal(result.statusCode, 502);
  assertV36Error(result, "PROMPT_IMAGE_BACKEND_UNAVAILABLE");
  assert.deepEqual(result.payload.error.backend_call_summary, {
    stage: "provider_normalize",
    endpoint_kind: "unknown",
    provider_error_code: "IMAGE_PROVIDER_CALL_FAILED",
    retryable: false
  });
  assertNoUnsafeBackendCallSummary(result.payload);
});

test("provider 200 unsupported image format is classified as provider_normalize without fake URL", async () => {
  const result = await withTempProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }, () => handleImageGeneration({
    task_type: "text_image",
    prompt: "生成山间晨雾。",
    references: [],
    output: { count: 1, aspect_ratio: "1:1", quality: "high" }
  }, {
    provider: generateWithAiTuProvider,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: "done: https://provider.example.com/generated/not-image"
          }
        }]
      }),
      headers: { get: () => "application/json" }
    })
  }));

  assert.equal(result.statusCode, 502);
  assertV36Error(result, "PROMPT_IMAGE_BACKEND_INVALID_RESPONSE");
  assert.deepEqual(result.payload.images, []);
  assert.deepEqual(result.payload.error.backend_call_summary, {
    stage: "provider_normalize",
    endpoint_kind: "unknown",
    provider_error_code: "IMAGE_RESULT_EMPTY",
    retryable: false
  });
  assertNoUnsafeBackendCallSummary(result.payload);
});

test("trace store records only redacted backend-call-summary fields", async () => {
  const traceFile = join(process.cwd(), ".codex-agent-team/state/trace-store.jsonl");
  const before = safeReadLines(traceFile).length;
  await appendTrace({
    endpoint: "/api/v1/image-generations",
    method: "POST",
    trace_id: "trace_unit",
    request_id: "req_unit",
    task_type: "text_image",
    generation_mode: "text_to_image",
    prompt: "must be hashed",
    reference_count: 0,
    callback_present: false,
    image_count: 0,
    status: "failed",
    error_code: "PROMPT_IMAGE_BACKEND_UNAVAILABLE",
    warning_count: 0,
    backend_call_summary: {
      stage: "provider_submit",
      endpoint_kind: "generations",
      upstream_status: 502,
      provider_error_code: "upstream_terminated",
      retryable: true,
      raw_url: "https://provider.example.com/v1/images/generations?token=secret",
      api_key: "test-key",
      raw_body: samplePngBase64()
    }
  });
  const after = safeReadLines(traceFile);
  assert.equal(after.length, before + 1);
  const record = JSON.parse(after[after.length - 1]);
  assert.deepEqual(record.backend_call_summary, {
    stage: "provider_submit",
    endpoint_kind: "generations",
    upstream_status: 502,
    provider_error_code: "upstream_terminated",
    retryable: true
  });
  assert.equal(record.prompt_sha256_16.length, 16);
  const publicText = JSON.stringify(record);
  assert.equal(publicText.includes("must be hashed"), false);
  assert.equal(publicText.includes("provider.example.com"), false);
  assert.equal(publicText.includes("secret"), false);
  assert.equal(publicText.includes("test-key"), false);
  assert.equal(publicText.includes(samplePngBase64()), false);
});

test("missing provider config returns PROVIDER_CONFIG_MISSING through real adapter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "provider-empty-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({}), "utf8");
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;
  const oldBase = process.env.IMAGE_API_BASE;
  const oldModel = process.env.IMAGE_MODEL;
  const oldConfigFile = process.env.AI_TU_RUNTIME_CONFIG_FILE;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  delete process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_MODEL;
  process.env.AI_TU_RUNTIME_CONFIG_FILE = configFile;
  try {
    const result = await handleImageGeneration({
      task_type: "text_image",
      prompt: "生成山水。",
      references: []
    });
    assertV36Error(result, "PROMPT_IMAGE_BACKEND_NOT_CONFIGURED");
  } finally {
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_MODEL", oldModel);
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider config fixes endpoints and model and requires at least one key", () => {
  assert.equal(hasRequiredProviderConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    apiKey: "test-key"
  })), true);
  const hostile = sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    apiKey: "test-key"
  });
  assert.equal(hostile.model, "gpt-image-2");
  assert.equal(hostile.imageModel, "gpt-image-2");
  assert.equal(hostile.baseUrl, "https://provider.example.com/v1/images/generations");
  assert.equal(hostile.imageEditUrl, "https://provider.example.com/v1/images/edits");
  assert.equal(hasRequiredProviderConfig(sanitizeProviderConfig({ apiKey: "" })), false);
  assert.throws(() => sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/edits",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    apiKey: "test-key"
  }), /generations/);
  const configuredReferenceEndpoint = sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    apiKey: "test-key"
  });
  assert.equal(configuredReferenceEndpoint.imageEditUrl, "https://provider.example.com/v1/images/generations");
  assert.equal(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    pollBaseUrl: "https://provider.example.com/v1/tasks",
    apiKey: "test-key"
  }).pollBaseUrl, "https://provider.example.com/v1/tasks");
  assert.throws(() => sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    pollBaseUrl: "https://provider.example.com/tasks",
    apiKey: "test-key"
  }), /provider poll url/);
  assert.throws(() => sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    pollBaseUrl: "http://127.0.0.1:9999/v1/tasks",
    apiKey: "test-key"
  }), /provider poll url/);
  for (const pollBaseUrl of [
    "http://localhost:9999/v1/tasks",
    "http://10.0.0.5/v1/tasks",
    "http://172.16.0.5/v1/tasks",
    "http://192.168.1.5/v1/tasks",
    "http://169.254.169.254/v1/tasks",
    "http://[::1]:9999/v1/tasks",
    "http://[fe80::1]/v1/tasks",
    "http://[fc00::1]/v1/tasks"
  ]) {
    assert.throws(() => sanitizeProviderConfig({
      baseUrl: "https://provider.example.com/v1/images/generations",
      imageEditUrl: "https://provider.example.com/v1/images/edits",
      pollBaseUrl,
      apiKey: "test-key"
    }), /provider poll url/);
  }
});

test("provider config can be read from ai-tu runtime config file while fixing model", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-config-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    imageTransport: "url",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
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
    assert.equal(config.imageEditUrl, "https://provider.example.com/v1/images/generations");
    assert.equal(config.imageTransport, "url");
    assert.equal(config.model, "gpt-image-2");
    assert.equal(config.imageModel, "gpt-image-2");
  } finally {
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_MODEL", oldModel);
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider config can be read from markdown runtime config notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-config-md-"));
  const configFile = join(dir, "runtime-config.md");
  writeFileSync(configFile, `${JSON.stringify({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/generations",
    imageTransport: "url",
    apiKey: "test-key"
  }, null, 2)}

Provider notes below this line are ignored by the runtime config parser.
https://provider.example.com/v1/images/generations
`, "utf8");

  const oldConfigFile = process.env.AI_TU_RUNTIME_CONFIG_FILE;
  const oldBase = process.env.IMAGE_API_BASE;
  const oldEditBase = process.env.IMAGE_EDIT_BASE;
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;
  delete process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_EDIT_BASE;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  process.env.AI_TU_RUNTIME_CONFIG_FILE = configFile;

  try {
    const config = defaultProviderConfig();
    assert.equal(hasRequiredProviderConfig(config), true);
    assert.equal(config.baseUrl, "https://provider.example.com/v1/images/generations");
    assert.equal(config.imageEditUrl, "https://provider.example.com/v1/images/generations");
    assert.equal(config.imageTransport, "url");
  } finally {
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_EDIT_BASE", oldEditBase);
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider config prefers workspace authoritative markdown over legacy ai-tu json fallback files", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-config-authoritative-md-"));
  const previousCwd = process.cwd();
  const oldConfigFile = process.env.AI_TU_RUNTIME_CONFIG_FILE;
  const oldBase = process.env.IMAGE_API_BASE;
  const oldEditBase = process.env.IMAGE_EDIT_BASE;
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;

  writeFileSync(join(dir, "真实配置_toapis.md"), `${JSON.stringify({
    baseUrl: "https://toapis.example.com/v1/images/generations",
    imageEditUrl: "https://toapis.example.com/v1/images/generations",
    imageTransport: "url",
    apiKey: "authoritative-key"
  }, null, 2)}

Authoritative markdown runtime config.
`, "utf8");

  mkdirSync(join(dir, "ai-tu"), { recursive: true });
  writeFileSync(join(dir, "ai-tu", "runtime-config.json"), JSON.stringify({
    baseUrl: "https://legacy.example.com/v1/images/generations",
    imageEditUrl: "https://legacy.example.com/v1/images/edits",
    apiKey: "legacy-key"
  }), "utf8");

  delete process.env.AI_TU_RUNTIME_CONFIG_FILE;
  delete process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_EDIT_BASE;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  try {
    process.chdir(dir);
    const config = defaultProviderConfig();
    assert.equal(config.baseUrl, "https://toapis.example.com/v1/images/generations");
    assert.equal(config.imageEditUrl, "https://toapis.example.com/v1/images/generations");
    assert.equal(config.imageTransport, "url");
    assert.equal(config.apiKey, "authoritative-key");
  } finally {
    process.chdir(previousCwd);
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_EDIT_BASE", oldEditBase);
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider config normalizes legacy edits baseUrl into the fixed text endpoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-config-legacy-edits-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    baseUrl: "https://provider.example.com/v1/images/edits",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    keyMode: "single",
    apiKey: "test-key"
  }), "utf8");

  const oldConfigFile = process.env.AI_TU_RUNTIME_CONFIG_FILE;
  const oldBase = process.env.IMAGE_API_BASE;
  const oldEditBase = process.env.IMAGE_EDIT_BASE;
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;
  delete process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_EDIT_BASE;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  process.env.AI_TU_RUNTIME_CONFIG_FILE = configFile;

  try {
    const config = defaultProviderConfig();
    assert.equal(hasRequiredProviderConfig(config), true);
    assert.equal(config.baseUrl, "https://provider.example.com/v1/images/generations");
    assert.equal(config.imageEditUrl, "https://provider.example.com/v1/images/edits");
    assert.equal(config.model, "gpt-image-2");
    assert.equal(config.imageModel, "gpt-image-2");
  } finally {
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_EDIT_BASE", oldEditBase);
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider config allows provider-specific reference endpoint paths", () => {
  const config = sanitizeProviderConfig({
    baseUrl: "https://toapis.com/v1/images/generations",
    imageEditUrl: "https://toapis.com/v1/images/generations",
    imageTransport: "url",
    keyMode: "single",
    apiKey: "test-key",
    requestTimeoutSeconds: 900,
    pollTimeoutSeconds: 900
  });
  assert.equal(config.baseUrl, "https://toapis.com/v1/images/generations");
  assert.equal(config.imageEditUrl, "https://toapis.com/v1/images/generations");
  assert.equal(config.imageTransport, "url");
  assert.equal(config.pollBaseUrl, "https://toapis.com/v1/images/generations");
  assert.equal(config.requestTimeoutSeconds, 900);
  assert.equal(config.pollTimeoutSeconds, 900);
  assert.equal(config.model, "gpt-image-2");
  assert.equal(config.imageModel, "gpt-image-2");
  const sameEndpoint = sanitizeProviderConfig({
    baseUrl: "https://toapis.com/v1/images/generations",
    imageEditUrl: "https://toapis.com/v1/images/generations",
    imageTransport: "url",
    apiKey: "test-key"
  });
  assert.equal(sameEndpoint.imageEditUrl, "https://toapis.com/v1/images/generations");
});

test("provider config maps URL transport imageEditUrl edits path to generations", () => {
  const urlTransported = sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    imageTransport: "url",
    keyMode: "single",
    apiKey: "test-key"
  });
  assert.equal(urlTransported.imageEditUrl, "https://provider.example.com/v1/images/generations");
});

test("provider config infers fixed generations and edits endpoints but not model from imageModel", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-tu-config-partial-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    imageModel: "gpt-image-2",
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
    assert.equal(config.baseUrl, "https://toapis.com/v1/images/generations");
    assert.equal(config.imageEditUrl, "https://provider.example.com/v1/images/edits");
    assert.equal(config.model, "gpt-image-2");
    assert.equal(config.imageModel, "gpt-image-2");
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

async function withTempProviderConfig(config, fn) {
  const dir = mkdtempSync(join(tmpdir(), "provider-config-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify(config), "utf8");
  const oldConfigFile = process.env.AI_TU_RUNTIME_CONFIG_FILE;
  const oldBase = process.env.IMAGE_API_BASE;
  const oldEditBase = process.env.IMAGE_EDIT_BASE;
  const oldModel = process.env.IMAGE_MODEL;
  const oldImageModel = process.env.IMAGE_MODEL_IMAGE;
  const oldImageModelForImage = process.env.IMAGE_MODEL_FOR_IMAGE;
  const oldKey = process.env.IMAGE_API_KEY;
  const oldKeys = process.env.IMAGE_API_KEYS;
  delete process.env.IMAGE_API_BASE;
  delete process.env.IMAGE_EDIT_BASE;
  delete process.env.IMAGE_MODEL;
  delete process.env.IMAGE_MODEL_IMAGE;
  delete process.env.IMAGE_MODEL_FOR_IMAGE;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_KEYS;
  process.env.AI_TU_RUNTIME_CONFIG_FILE = configFile;
  try {
    return await fn();
  } finally {
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_EDIT_BASE", oldEditBase);
    restoreEnv("IMAGE_MODEL", oldModel);
    restoreEnv("IMAGE_MODEL_IMAGE", oldImageModel);
    restoreEnv("IMAGE_MODEL_FOR_IMAGE", oldImageModelForImage);
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    rmSync(dir, { recursive: true, force: true });
  }
}

function providerFetchRecorder(calls) {
  return async (url, init) => {
    if (!init || !init.method) {
      calls.push({
        kind: String(url).includes("/generated.") ? "provider-image" : "reference",
        url
      });
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => samplePngBytes(),
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null }
      };
    }
    const body = await summarizeProviderRequestBody(init.body);
    calls.push({
      kind: "submit",
      url,
      method: init.method,
      headers: init.headers || {},
      body
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ url: imageUrl, width: 1920, height: 1080 }] }),
      headers: { get: () => null }
    };
  };
}

function providerPollConfig(overrides = {}) {
  return {
    baseUrl: "https://provider.example.com/v1/images/generations",
    imageEditUrl: "https://provider.example.com/v1/images/edits",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    keyMode: "single",
    apiKey: "test-key",
    apiKeys: ["test-key"],
    requestTimeoutSeconds: 10,
    retryAttempts: 1,
    pollTimeoutSeconds: 10,
    pollIntervalSeconds: 1,
    pollBaseUrl: "https://provider.example.com/v1/tasks",
    ...overrides
  };
}

async function summarizeProviderRequestBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  if (body instanceof FormData) {
    const summary = { imageCount: 0, imageFieldNames: [], imageFileNames: [], imageMimeTypes: [] };
    for (const [key, value] of body.entries()) {
      if (key === "image" || key === "image[]") {
        summary.imageCount += 1;
        summary.imageFieldNames.push(key);
        summary.imageFileNames.push(value && typeof value === "object" && "name" in value ? value.name : "");
        summary.imageMimeTypes.push(value && typeof value === "object" && "type" in value ? value.type : "");
        continue;
      }
      summary[key] = String(value);
    }
    return summary;
  }
  return {};
}

function assertNoForbiddenModel(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes("gpt-image-2-all"), false);
  assert.equal(text.includes("gpt-image-1"), false);
  assert.equal(/dall-e-/i.test(text), false);
}

function bindingFor(body) {
  const request = normalizeRequest({
    reference_policy: { unbound_entity: "warn" },
    output: { count: 1, aspect_ratio: "16:9", quality: "high" },
    ...body
  });
  return resolveReferences(request, extractEntityMentions(request.prompt));
}

function emptyBinding() {
  return {
    entity_mentions: [],
    resolved_references: [],
    references_used: [],
    warnings: []
  };
}

function characterRef(overrides = {}) {
  return {
    reference_id: "ref_char_xzn_001",
    entity_name: "萧昭宁",
    entity_type: "character",
    role: "character_reference",
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

function assertNoUnsafeBackendCallSummary(payload) {
  const text = JSON.stringify(payload);
  for (const forbidden of [
    "provider.example.com",
    "Authorization",
    "Bearer",
    "test-key",
    "token",
    "secret",
    "raw endpoint",
    "data:image",
    "b64_json",
    samplePngBase64()
  ]) {
    assert.equal(text.includes(forbidden), false, `unsafe backend-call-summary leaked: ${forbidden}`);
  }
}

function safeReadLines(filePath) {
  try {
    return readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function assertV36Success(result, imageCount = 1) {
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.deepEqual(Object.keys(result.payload).sort(), ["images", "status", "warnings"]);
  assert.equal(result.payload.images.length, imageCount);
  for (const image of result.payload.images) {
    assert.deepEqual(Object.keys(image).sort(), ["url"]);
    assert.match(image.url, /^https?:\/\//);
  }
  assert.equal(Array.isArray(result.payload.warnings), true);
  assertNoForbidden(result.payload);
}

function assertV36Error(result, code, statusCode = null, status = "failed") {
  if (statusCode != null) assert.equal(result.statusCode, statusCode);
  assert.equal(result.payload.status, status);
  assert.deepEqual(Object.keys(result.payload).sort(), ["error", "images", "status", "warnings"]);
  assert.equal(result.payload.error.code, code);
  assert.equal(typeof result.payload.error.message, "string");
  assert.ok(result.payload.error.message.length > 0);
  assert.deepEqual(result.payload.images, []);
  assert.deepEqual(result.payload.warnings, []);
  assertNoForbidden(result.payload);
}

function restoreEnv(name, oldValue) {
  if (oldValue == null) delete process.env[name];
  else process.env[name] = oldValue;
}

function samplePngBase64() {
  return samplePngBytes().toString("base64");
}

function samplePngBytes() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

function samplePngArrayBuffer() {
  const bytes = samplePngBytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sampleJpegBytes() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00,
    0xff, 0xd9
  ]);
}

function sampleWebpBytes() {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46,
    0x16, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
    0x0a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x00, 0x00, 0x00, 0x00
  ]);
}

function sampleGifBytes() {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
}

function fakePngHeaderBytes() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x6e, 0x6f, 0x74, 0x2d, 0x61, 0x2d, 0x70, 0x6e, 0x67
  ]);
}

function fakePngSkeletonBytes() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0x00, 0x00, 0x00, 0x00
  ]);
}

function fakeJpegHeaderBytes() {
  return Buffer.from([0xff, 0xd8, 0xff, 0x6e, 0x6f, 0x74, 0x2d, 0x61, 0x2d, 0x6a, 0x70, 0x65, 0x67]);
}

function fakeJpegSoiEoiBytes() {
  return Buffer.from([0xff, 0xd8, 0x6e, 0x6f, 0x74, 0x2d, 0x61, 0x2d, 0x6a, 0x70, 0x65, 0x67, 0xff, 0xd9]);
}

function fakeWebpHeaderBytes() {
  return Buffer.from("RIFFzzzzWEBPnot-a-webp");
}

function fakeWebpEmptyVp8Bytes() {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46,
    0x0c, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
    0x00, 0x00, 0x00, 0x00
  ]);
}
