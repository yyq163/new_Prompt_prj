import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleImageGeneration } from "../../src/routes/image-generations.js";
import { resolveGeneratedImagePublicBaseUrl } from "../../src/routes/image-generations.js";
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
  hasRequiredProviderConfig,
  longRunningSubmitConfig,
  normalizeProviderImageObject,
  normalizeProviderResult,
  fetchUpstreamOnce,
  postLiveImageUrlJson,
  sanitizeProviderConfig
} from "../../src/providers/ai-tu-provider-adapter.js";
import {
  clearGeneratedImagesForTest,
  deleteGeneratedImage,
  getGeneratedImage,
  putGeneratedImage
} from "../../src/core/generated-image-store.js";
import { generatedImageHttpResponse } from "../../src/core/generated-image-response.js";

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
  assert.equal(withCallbackUrl.payload.status, "succeeded");
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
  try {
    delete process.env.ALLOW_LOCAL_REFERENCE_URLS;
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
    process.env.ALLOW_LOCAL_REFERENCE_URLS = "true";
    assert.equal(assertReferenceUrlAllowed("http://127.0.0.1/ref.png"), "http://127.0.0.1/ref.png");
    assert.throws(() => normalizeRequest({
      task_type: "text_image",
      prompt: "生成山水。",
      callback_url: "http://127.0.0.1/cb"
    }), /callback_url/);
  } finally {
    restoreEnv("ALLOW_LOCAL_REFERENCE_URLS", oldAllowLocal);
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
    clearGeneratedImagesForTest();
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
    assert.match(result.payload.images[0].url, /^https:\/\/img\.example\.com\/api\/v1\/generated-images\/img_/);
    assert.doesNotMatch(result.payload.images[0].url, /\/\/api\/v1/);

    process.env.PUBLIC_BASE_URL = "ftp://bad.example.com";
    assert.throws(() => resolveGeneratedImagePublicBaseUrl(), /PUBLIC_BASE_URL/);

    delete process.env.PUBLIC_BASE_URL;
    process.env.NODE_ENV = "production";
    assert.throws(() => resolveGeneratedImagePublicBaseUrl(), /PUBLIC_BASE_URL/);

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
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.generation_mode, "image_to_image");
});

test("character_multiview character reference succeeds", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 的四视图。",
    references: [characterRef()]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.normalized.references_used[0].role, "character_reference");
  assert.equal("usage" in result.payload.normalized.references_used[0], false);
});

test("character_multiview accepts face_reference", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 的四视图。",
    references: [characterRef({ role: "face_reference", entity_type: "character" })]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.normalized.references_used[0].role, "face_reference");
});

test("character_multiview character plus scene references succeed", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的角色设定。",
    references: [characterRef(), sceneRef()]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.normalized.references_used.length, 2);
});

test("scene_multiview scene plus character references succeed", async () => {
  const result = await call({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [characterRef(), sceneRef()]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.task_type, "scene_multiview");
  assert.equal(result.payload.normalized.entity_mentions.length, 2);
});

test("scene_multiview accepts lighting and composition references without scene role", async () => {
  const lighting = await call({
    task_type: "scene_multiview",
    prompt: "生成 @冷色光影 的现场光影多视角参考图",
    references: [sceneRef({ reference_id: "ref_light", entity_name: "冷色光影", entity_type: "lighting", role: "lighting_reference" })]
  });
  assert.equal(lighting.payload.status, "succeeded");
  assert.equal(lighting.payload.normalized.references_used[0].role, "lighting_reference");
  assert.equal(lighting.payload.warnings[0].code, "SCENE_REFERENCE_MISSING");

  const composition = await call({
    task_type: "scene_multiview",
    prompt: "生成 @对称构图 的现场光影多视角参考图",
    references: [sceneRef({ reference_id: "ref_comp", entity_name: "对称构图", entity_type: "composition", role: "composition_reference" })]
  });
  assert.equal(composition.payload.status, "succeeded");
  assert.equal(composition.payload.normalized.references_used[0].role, "composition_reference");
});

test("prop_multiview prop reference succeeds", async () => {
  const result = await call({
    task_type: "prop_multiview",
    prompt: "生成 @铜镜 的道具多视图。",
    references: [propRef()]
  });
  assert.equal(result.payload.status, "succeeded");
});

test("prop_multiview accepts material and ornament references", async () => {
  const material = await call({
    task_type: "prop_multiview",
    prompt: "生成 @青铜材质 的道具材质多视图。",
    references: [propRef({ reference_id: "ref_material", entity_name: "青铜材质", entity_type: "material", role: "material_reference" })]
  });
  assert.equal(material.payload.status, "succeeded");
  assert.equal(material.payload.normalized.references_used[0].role, "material_reference");

  const ornament = await call({
    task_type: "prop_multiview",
    prompt: "生成 @云纹装饰 的道具纹样多视图。",
    references: [propRef({ reference_id: "ref_ornament", entity_name: "云纹装饰", entity_type: "ornament", role: "ornament_reference" })]
  });
  assert.equal(ornament.payload.status, "succeeded");
  assert.equal(ornament.payload.normalized.references_used[0].role, "ornament_reference");
});

test("character_multiview without character or face reference returns warning but succeeds", async () => {
  const result = await call({
    task_type: "character_multiview",
    prompt: "生成一名银发医师的角色四视图。",
    references: [sceneRef({ entity_name: "医馆", role: "scene_reference", entity_type: "scene" })]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.warnings[0].code, "CHARACTER_REFERENCE_MISSING");
});

test("scene_multiview without scene reference returns warning but succeeds", async () => {
  const result = await call({
    task_type: "scene_multiview",
    prompt: "生成 @研究员 的现场光影多视角参考图。",
    references: [characterRef({ entity_name: "研究员" })]
  });
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.warnings[0].code, "SCENE_REFERENCE_MISSING");
});

test("prop_multiview without prop material or ornament reference returns warning but succeeds", async () => {
  const result = await call({
    task_type: "prop_multiview",
    prompt: "生成一件符文器具的多角度资产图。",
    references: [sceneRef({ entity_name: "工坊", role: "scene_reference", entity_type: "scene" })]
  });
  assert.equal(result.payload.status, "succeeded");
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
  assert.equal(result.payload.error_code, "DUPLICATE_REFERENCE_ID");
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
  assert.equal(result.payload.status, "succeeded");
  assert.deepEqual(result.payload.normalized.entity_mentions[0].matched_reference_ids, ["ref_a", "ref_b"]);
  assert.equal(result.payload.normalized.references_used.length, 2);
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
  assert.equal(result.payload.status, "succeeded");
  assert.deepEqual(result.payload.normalized.references_used.map((item) => item.reference_id), ["ref_a", "ref_scene_unmentioned"]);
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

test("provider base64-only response is exposed through generated image URL", () => {
  clearGeneratedImagesForTest();
  const images = extractImageUrls({ data: [{ b64_json: samplePngBase64(), mime_type: "image/png" }] });
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_/);
  assert.equal(images[0].format, "png");
  const stored = getGeneratedImage(images[0].image_id);
  assert.equal(stored.mime, "image/png");
  assert.equal(Buffer.isBuffer(stored.bytes), true);
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

test("provider data URL response is exposed through generated image URL", () => {
  clearGeneratedImagesForTest();
  const images = extractImageUrls({
    data: [{ image: `data:image/png;base64,${samplePngBase64()}`, width: 64, height: 64 }]
  });
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_/);
  assert.equal(images[0].width, 64);
  assert.equal(images[0].height, 64);
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");
});

test("provider binary buffer response is exposed through generated image URL", () => {
  clearGeneratedImagesForTest();
  const image = normalizeProviderImageObject({ binary: samplePngBytes(), mime_type: "image/png" }, "png");
  assert.match(image.url, /^\/api\/v1\/generated-images\/img_/);
  assert.equal(image.format, "png");
  assert.equal(getGeneratedImage(image.image_id).mime, "image/png");
});

test("provider direct binary HTTP image response is normalized as generated image bytes", async () => {
  clearGeneratedImagesForTest();
  const json = await fetchUpstreamOnce("https://provider.example.com/v1/images/generations", {
    method: "POST",
    headers: {}
  }, async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null },
    arrayBuffer: async () => samplePngBytes().buffer.slice(
      samplePngBytes().byteOffset,
      samplePngBytes().byteOffset + samplePngBytes().byteLength
    )
  }), {
    baseUrl: "https://provider.example.com/v1/images/generations",
    requestTimeoutSeconds: 10
  });
  const images = extractImageUrls(json);
  assert.equal(images.length, 1);
  assert.match(images[0].url, /^\/api\/v1\/generated-images\/img_/);
  assert.equal(getGeneratedImage(images[0].image_id).mime, "image/png");
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

test("provider invalid image mime or oversized bytes returns PROVIDER_RESPONSE_UNSUPPORTED", () => {
  assert.throws(() => extractImageUrls({
    data: [{ b64_json: "not-valid-base64***" }]
  }), /base64 图片格式非法/);
  assert.throws(() => normalizeProviderImageObject({
    b64_json: Buffer.from("not-an-image").toString("base64"),
    mime_type: "image/gif"
  }, "gif"), /不是支持的图片格式/);
  assert.throws(() => putGeneratedImage({
    bytes: sampleGifBytes(),
    mime: "image/gif"
  }), /不是支持的图片格式/);
  assert.throws(() => putGeneratedImage({
    bytes: samplePngBytes(),
    mime: "image/jpeg"
  }), /MIME 类型与图片字节不匹配/);
  assert.throws(() => putGeneratedImage({
    bytes: samplePngBytes(),
    mime: "image/png",
    maxBytes: 4
  }), /超过大小限制/);
});

test("plain provider result text is not treated as base64 image", () => {
  assert.throws(() => extractImageUrls({ result: "task completed without image bytes" }), /没有找到可访问的图片/);
});

test("public API returns URL only for provider-generated bytes and never exposes base64", async () => {
  clearGeneratedImagesForTest();
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
  assert.match(result.payload.images[0].url, /^http:\/\/127\.0\.0\.1:8787\/api\/v1\/generated-images\/img_/);
  assert.equal(JSON.stringify(result.payload).includes(samplePngBase64()), false);
  assert.equal(JSON.stringify(result.payload).includes("provider_internal_payload"), false);
  assertNoForbidden(result.payload);
});

test("long-running image submit waits beyond relay completion time and does not retry non-idempotent generation", async () => {
  const config = longRunningSubmitConfig(sanitizeProviderConfig({
    baseUrl: "https://provider.example.com/v1/images/generations",
    model: "gpt-image-2",
    imageModel: "gpt-image-2-all",
    apiKey: "test-key",
    requestTimeoutSeconds: 180,
    retryAttempts: 5
  }));
  assert.equal(config.requestTimeoutSeconds >= 420, true);
  assert.equal(config.retryAttempts, 1);

  let calls = 0;
  await assert.rejects(() => postLiveImageUrlJson({
    model: "gpt-image-2-all",
    prompt: "生成参考图",
    n: 1,
    size: "1024x1024",
    quality: "high",
    output_format: "png",
    images: [{ image_url: "https://example.com/ref.png" }]
  }, {
    ...config,
    requestTimeoutSeconds: 10
  }, async () => {
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
    assert.equal(result.payload.error_code, "PROVIDER_CONFIG_MISSING");
  } finally {
    restoreEnv("IMAGE_API_KEY", oldKey);
    restoreEnv("IMAGE_API_KEYS", oldKeys);
    restoreEnv("IMAGE_API_BASE", oldBase);
    restoreEnv("IMAGE_MODEL", oldModel);
    restoreEnv("AI_TU_RUNTIME_CONFIG_FILE", oldConfigFile);
    rmSync(dir, { recursive: true, force: true });
  }
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

function restoreEnv(name, oldValue) {
  if (oldValue == null) delete process.env[name];
  else process.env[name] = oldValue;
}

function samplePngBase64() {
  return samplePngBytes().toString("base64");
}

function samplePngBytes() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89
  ]);
}

function sampleGifBytes() {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
}
