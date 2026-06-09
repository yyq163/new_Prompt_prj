import { ImageApiError, clarification, fail, publicErrorPayload } from "../core/errors.js";
import { extractEntityMentions } from "../core/entity-mentions.js";
import { assertNoForbiddenPublicFields, makeId, normalizeRequest, stringValue } from "../core/runtime.js";
import { roleLabel, taskTypeLabel, VALID_REFERENCE_ROLES, VALID_USAGES } from "../core/labels.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RAGFLOW_TIMEOUT_MS = 45_000;
const ROOT = resolve(import.meta.dirname, "../..");
const PROMPT_MIN_CJK = 80;

export async function handlePromptOptimization(body, options = {}) {
  const fallbackRequestId = stringValue(body && body.request_id).trim() || makeId("req");
  const traceId = makeId("trace");
  try {
    if (body && body.__invalid) {
      throw new ImageApiError({
        statusCode: 400,
        status: "failed",
        errorCode: body.error_code || "INVALID_REQUEST_SCHEMA",
        message: body.message || "请求体不是合法 JSON。"
      });
    }

    const request = normalizePromptOptimizationRequest({
      output: { aspect_ratio: "16:9", quality: "high", count: 1 },
      ...body,
      request_id: fallbackRequestId
    });
    const context = await buildPromptOptimizationContext(request, {
      fetchImpl: options.fetchImpl || globalThis.fetch,
      env: options.env || process.env
    });
    const optimizedPrompt = compileOptimizedPrompt(context);
    validateOptimizedPrompt(optimizedPrompt, context);
    return {
      statusCode: 200,
      payload: buildPromptOptimizationResponse({
        request,
        context,
        optimizedPrompt,
        traceId
      })
    };
  } catch (error) {
    const result = publicErrorPayload(error, fallbackRequestId);
    const payload = {
      ...result.payload,
      trace_id: traceId
    };
    assertNoForbiddenPublicFields(payload);
    return { statusCode: result.statusCode, payload };
  }
}

export function normalizePromptOptimizationRequest(body) {
  const request = normalizeRequest(body);
  return {
    ...request,
    entity_mentions: extractEntityMentions(request.prompt)
  };
}

async function buildPromptOptimizationContext(request, options = {}) {
  const binding = resolvePromptOptimizationReferences(request, request.entity_mentions);
  const referencePlan = buildReferencePlan({
    request,
    entity_mentions: binding.entity_mentions,
    resolved_references: binding.resolved_references
  });
  const enhancement = await callRagflowEnhancementIfAvailable({
    request,
    binding,
    referencePlan,
    fetchImpl: options.fetchImpl,
    env: options.env
  });
  return {
    request,
    binding,
    referencePlan,
    enhancement
  };
}

function resolvePromptOptimizationReferences(request, entityMentions) {
  const references = validateReferences(request.references || []);
  const warnings = [];
  const refsByEntity = new Map();
  for (const ref of references) {
    const list = refsByEntity.get(ref.entity_name) || [];
    list.push(ref);
    refsByEntity.set(ref.entity_name, list);
  }

  const normalizedMentions = entityMentions.map((mention) => {
    const matched = refsByEntity.get(mention.entity_name) || [];
    if (matched.length) {
      return {
        mention_id: mention.mention_id,
        marker: mention.marker,
        entity_name: mention.entity_name,
        reference_status: "bound",
        matched_reference_ids: matched.map((item) => item.reference_id)
      };
    }
    const warning = {
      code: "ENTITY_REFERENCE_NOT_FOUND",
      message: `实体「${mention.entity_name}」没有绑定参考图。`,
      entity_name: mention.entity_name
    };
    if (request.reference_policy.unbound_entity === "block") {
      clarification("ENTITY_REFERENCE_NOT_FOUND", warning.message, 200, warning);
    }
    warnings.push(warning);
    return {
      mention_id: mention.mention_id,
      marker: mention.marker,
      entity_name: mention.entity_name,
      reference_status: "unbound",
      matched_reference_ids: []
    };
  });

  if (request.task_type === "image_reference" && !references.length) {
    clarification("REFERENCE_REQUIRED", "image_reference 需要至少一张参考图。");
  }

  return {
    entity_mentions: normalizedMentions,
    resolved_references: references,
    references_used: references.map(publicPromptReference),
    warnings
  };
}

export function validateReferences(references = []) {
  if (!Array.isArray(references)) fail("INVALID_REQUEST_SCHEMA", "references 必须是数组。");
  const seenIds = new Set();
  const groups = new Map();
  const normalized = references.map((ref, index) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
      fail("INVALID_REQUEST_SCHEMA", `第 ${index + 1} 个 reference 必须是对象。`);
    }
    if (!ref.reference_id) fail("INVALID_REQUEST_SCHEMA", "reference_id 不能为空。");
    if (seenIds.has(ref.reference_id)) fail("DUPLICATE_REFERENCE_ID", "参考图 ID 重复，请检查上传的参考图。");
    seenIds.add(ref.reference_id);
    if (!ref.entity_name) fail("INVALID_REQUEST_SCHEMA", "reference.entity_name 不能为空。");
    if (!VALID_REFERENCE_ROLES.includes(ref.role)) fail("INVALID_REFERENCE_ROLE", "参考图 role 不合法。");
    if (ref.usage && !VALID_USAGES.includes(ref.usage)) fail("INVALID_REQUEST_SCHEMA", "reference.usage 必须是 primary 或 auxiliary。");
    if (!/^https?:\/\//i.test(ref.url)) fail("INVALID_REQUEST_SCHEMA", "reference.url 必须是 http 或 https URL。");

    const item = {
      ...ref,
      usage: ref.usage || "",
      order: Number.isFinite(Number(ref.order)) ? Number(ref.order) : index + 1,
      role_label: roleLabel(ref.role)
    };
    const groupKey = `${item.entity_name}\u0000${item.role}`;
    const list = groups.get(groupKey) || [];
    list.push(item);
    groups.set(groupKey, list);
    return item;
  });

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    if (group.some((item) => !item.usage)) {
      fail("DUPLICATE_ENTITY_ROLE_REFERENCE", `「${group[0].entity_name}」存在多张${roleLabel(group[0].role)}，请显式指定 primary/auxiliary。`);
    }
    if (group.filter((item) => item.usage === "primary").length > 1) {
      fail("MULTIPLE_PRIMARY_REFERENCES", `「${group[0].entity_name}」存在多张主参考图，请只保留一张 primary。`);
    }
  }
  return normalized.sort((a, b) => a.order - b.order);
}

function publicPromptReference(ref) {
  return {
    reference_id: ref.reference_id,
    entity_name: ref.entity_name,
    entity_type: ref.entity_type,
    role: ref.role,
    role_label: roleLabel(ref.role),
    usage: ref.usage || "",
    order: ref.order
  };
}

export async function callRagflowEnhancementIfAvailable({ request, binding, referencePlan, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  let config;
  try {
    config = ragflowConfig(env);
  } catch {
    return null;
  }
  try {
    const candidate = await callRagflowPromptOptimizer({
      request,
      binding,
      referencePlan,
      fetchImpl,
      env,
      config
    });
    return validateRagflowEnhancement(candidate, { request, binding, referencePlan });
  } catch {
    return null;
  }
}

export async function callRagflowPromptOptimizer({ request, binding, referencePlan, fetchImpl = globalThis.fetch, env = process.env, config = null } = {}) {
  const activeConfig = config || ragflowConfig(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RAGFLOW_TIMEOUT_MS);
  try {
    const response = await fetchImpl(activeConfig.endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeConfig.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: activeConfig.model,
        stream: false,
        temperature: 0.2,
        messages: [
          { role: "system", content: ragflowSystemPrompt() },
          { role: "user", content: ragflowUserPrompt(request, binding, referencePlan) }
        ]
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ImageApiError({
        statusCode: response.status === 404 ? 503 : 502,
        status: "failed",
        errorCode: response.status === 404 ? "RAGFLOW_OPENAI_ENDPOINT_NOT_FOUND" : "RAGFLOW_OPTIMIZER_FAILED",
        message: "提示词优化服务暂时不可用，请稍后重试。"
      });
    }
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return null;
    }
    if (isRagflowErrorEnvelope(json)) return null;
    return parseRagflowOptimizedPrompt(json);
  } catch (error) {
    if (error && error.name === "AbortError") return null;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function ragflowConfig(env = process.env) {
  const fileConfig = readRagflowRuntimeConfig(env);
  const baseUrl = stringValue(env.RAGFLOW_BASE_URL || fileConfig.baseUrl).trim().replace(/\/+$/u, "");
  const apiKey = stringValue(env.RAGFLOW_API_KEY || fileConfig.apiKey).trim();
  const chatId = stringValue(env.RAGFLOW_CHAT_ID || fileConfig.chatId).trim();
  if (!baseUrl || !apiKey || !chatId) {
    throw new ImageApiError({
      statusCode: 503,
      status: "failed",
      errorCode: "RAGFLOW_CONFIG_MISSING",
      message: "提示词优化服务配置缺失。"
    });
  }
  return {
    apiKey,
    model: stringValue(env.RAGFLOW_MODEL || fileConfig.model).trim() || "model",
    endpoint: `${baseUrl}/api/v1/openai/${encodeURIComponent(chatId)}/chat/completions`
  };
}

function readRagflowRuntimeConfig(env = process.env) {
  const candidates = [
    stringValue(env.AI_TU_RUNTIME_CONFIG_FILE).trim(),
    resolve(ROOT, "ai-tu/runtime-config.json"),
    resolve(ROOT, "ai-tu/runtime-config.example.json")
  ].filter(Boolean);
  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue;
      const json = JSON.parse(readFileSync(filePath, "utf8"));
      return {
        baseUrl: json.ragflowBaseUrl,
        apiKey: json.ragflowApiKey,
        chatId: json.ragflowChatId,
        model: json.ragflowModel
      };
    } catch {
      continue;
    }
  }
  return {};
}

function ragflowSystemPrompt() {
  return [
    "你是影视级 AIGC 生图提示词增强器，只输出可选结构化 enhancement。",
    "不要输出最终 prompt，不要输出 final_prompt，不要输出 compiled_prompt。",
    "输出 JSON 对象，字段只能来自 scene_summary、visual_focus、story_function、action_stages、shot_plan、normalized_shot_plan、lighting_notes、composition_notes、negative_notes、template_guidance。",
    "必须根据 task_type、raw_prompt、references[] 动态提供补充建议。",
    "不得新增 reference_id，不得新增图片 URL，不得改变主参考和辅助参考关系，不得把任何样例实体写死为规则。"
  ].join("");
}

function ragflowUserPrompt(request, binding, referencePlan) {
  const refs = binding.resolved_references || [];
  const referenceLines = refs.map((ref) => (
    `- ${mention(ref, ref.entity_type || "对象")}: entity_type=${ref.entity_type}, role=${ref.role}, usage=${ref.usage || "reference"}, description=${ref.description || ref.display_name || ""}`
  ));
  return [
    `task_type=${request.task_type}`,
    `raw_prompt=${request.prompt}`,
    `generation_mode=${referencePlan.generationMode}`,
    "",
    "references:",
    referenceLines.join("\n") || "* 无",
    "",
    "请输出 JSON enhancement。只给可选补充，不要生成最终生图 prompt。"
  ].join("\n");
}

export function parseRagflowOptimizedPrompt(json) {
  const candidates = extractPromptCandidates(json);
  for (const content of candidates) {
    const unwrapped = unwrapCodeFence(content);
    const parsed = parseJsonMaybe(unwrapped);
    if (parsed && typeof parsed === "object") return parsed;
    if (unwrapped) return { template_guidance: unwrapped };
  }
  return null;
}

export function validateRagflowEnhancement(candidate, context = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  if ("final_prompt" in candidate || "compiled_prompt" in candidate || "provider_payload" in candidate) return null;
  const jsonText = JSON.stringify(candidate);
  if (jsonText.length > 8000) return null;
  for (const title of forbiddenPromptHeadings()) {
    if (jsonText.includes(title)) return null;
  }
  if (/RAGFlow|fallback|provider\s*payload|provider_internal_payload|final_prompt|compiled_prompt/i.test(jsonText)) return null;

  const allowedReferenceIds = new Set((context.binding?.resolved_references || []).map((ref) => ref.reference_id));
  const allowedUrls = new Set((context.binding?.resolved_references || []).map((ref) => ref.url));
  const foundReferenceIds = findValuesByKey(candidate, "reference_id");
  if (foundReferenceIds.some((id) => id && !allowedReferenceIds.has(id))) return null;
  const foundUrls = findUrls(candidate);
  if (foundUrls.some((url) => !allowedUrls.has(url))) return null;

  return sanitizeEnhancement(candidate);
}

function sanitizeEnhancement(candidate) {
  const out = {};
  for (const key of [
    "scene_summary",
    "visual_focus",
    "story_function",
    "action_stages",
    "shot_plan",
    "normalized_shot_plan",
    "lighting_notes",
    "composition_notes",
    "negative_notes",
    "template_guidance"
  ]) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 1200);
    if (Array.isArray(value)) out[key] = value.slice(0, 24).map((item) => (
      typeof item === "string" ? item.slice(0, 400) : item && typeof item === "object" ? sanitizePlainObject(item) : null
    )).filter(Boolean);
  }
  return Object.keys(out).length ? out : null;
}

function sanitizePlainObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (["final_prompt", "compiled_prompt", "provider_payload", "enhancement"].includes(key)) continue;
    if (typeof item === "string") out[key] = item.slice(0, 240);
    else if (typeof item === "number" || typeof item === "boolean") out[key] = item;
  }
  return out;
}

export function compileOptimizedPrompt(context) {
  const { request } = context;
  switch (request.task_type) {
    case "text_image":
      return textImagePrompt(context);
    case "image_reference":
      return imageReferencePrompt(context);
    case "character_multiview":
      return characterMultiviewPrompt(context);
    case "scene_multiview":
      return sceneMultiviewPrompt(context);
    case "prop_multiview":
      return propMultiviewPrompt(context);
    case "storyboard":
      return storyboardPrompt(context);
    default:
      clarification("UNSUPPORTED_TASK_TYPE", "不支持的 task_type。");
  }
}

function textImagePrompt(context) {
  const theme = stripCommandPrefix(context.request.prompt);
  const guidance = enhancementText(context, ["visual_focus", "lighting_notes", "composition_notes", "template_guidance"]);
  return [
    `生成一张完整高质量的普通文字生图作品，主题围绕“${theme}”。画面需要清楚表达用户原始意图，主体明确，动作或状态自然，环境信息完整，构图稳定，前景、中景和背景层次分明。`,
    `${guidance}根据主题补充合理的画面气氛、镜头距离、色彩关系、光源方向、明暗层次、材质质感和清晰度要求，但不要强行套用人物四视图、场景多视图、道具多视图或故事板结构，也不要新增未提供的具体实体。`,
    "整体风格写实精致、画面干净、空间可信、细节可辨，适合直接发送给图片生成模型。",
    "不要出现文字、水印、标签、UI 标识、畸形肢体、重复主体、低清晰度、过度虚化、空间错乱或与主题无关的元素。"
  ].filter(Boolean).join("\n\n");
}

function imageReferencePrompt(context) {
  const refs = context.referencePlan.allRefs;
  const theme = stripCommandPrefix(context.request.prompt);
  const referenceText = refs.map((ref) => `${mention(ref, ref.entity_type || "参考对象")} 用作${roleUsageText(ref)}，保持${ref.description || ref.display_name || "关键视觉特征"}`).join("；");
  const guidance = enhancementText(context, ["visual_focus", "lighting_notes", "composition_notes", "template_guidance"]);
  return [
    `基于参考图生成一张新的完整图像，围绕“${theme}”组织主体、环境、构图、光影和材质。${referenceText}。`,
    `${guidance}参考图用于稳定主体特征、风格气质、构图关系、光影方向或材质细节；新画面可以根据提示词重新组织场景和镜头，但必须保持参考对象的关键视觉特征和绑定关系。`,
    "画面应是普通参考图生图结果，不要强行变成人物四视图、场景多视图、道具多视图或故事板。构图完整，主体边界清晰，材质细节可辨，光源统一。不要机械复制参考图，不要改变参考对象身份，不要混淆多个参考对象，不要新增未提供的主参考对象，不要出现文字、水印、标签、畸形结构、低清晰度或风格断裂。"
  ].filter(Boolean).join("\n\n");
}

function characterMultiviewPrompt(context) {
  const plan = context.referencePlan;
  const character = characterMainRefs(plan);
  const name = namesText(character, mentionFromRaw(context.request.prompt, "角色"));
  const auxiliaryText = auxiliaryRefsText({ ...plan, auxiliaryRefs: plan.auxiliaryRefs.filter((ref) => !isSameRefList(ref, character)) });
  const guidance = enhancementText(context, ["visual_focus", "composition_notes", "template_guidance"]);
  return [
    `生成一张人物多视角图，也就是角色四视图 / 角色设定图 / 人物一致性参考图，以 ${name} 作为角色主交付物。${name} 必须保持身份、五官特征、发型、服饰结构、身体比例、色彩搭配和整体气质稳定一致。`,
    `${auxiliaryText ? `辅助参考包括 ${auxiliaryText}，只能用于服装、发型、头饰、配饰、风格、光影或少量环境气氛辅助，不得改变角色主交付物。` : ""}${guidance}`,
    "画面必须采用 4 格横向布局：第一格为正面全身站姿，第二格为正面头部特写，第三格为侧面全身站姿，第四格为背面全身站姿。所有全身视图都必须头到脚完整，鞋子完整可见，A 字站姿，双手自然下垂或微微张开，手上无道具，比例统一，服装轮廓和细节在不同视角中保持一致。",
    "背景使用纯色背景或极简浅色背景，光线均匀，人物轮廓清晰，适合角色建模、角色一致性训练、后续 AIGC 角色复用和美术设定交付。",
    "不要生成普通人物写真、单张立绘、单一视角或剧情图；不要只有正面、缺侧面、缺背面、多个头部特写、手持武器或道具、复杂剧情背景抢主体；不要出现文字、水印、标签、UI 标识、畸形肢体、错乱五官、重复脸、低清晰度或服装前后不一致。"
  ].filter(Boolean).join("\n\n");
}

function sceneMultiviewPrompt(context) {
  const plan = context.referencePlan;
  const mainRefs = sceneMainRefs(plan);
  const sceneName = namesText(mainRefs, mentionFromRaw(context.request.prompt, "主场景"));
  const auxiliaryText = auxiliaryRefsText(plan);
  const characterText = namesText(plan.characterAuxiliaryRefs, "");
  const nonCharacterAuxiliaryText = auxiliaryRefsText({
    ...plan,
    auxiliaryRefs: plan.auxiliaryRefs.filter((ref) => !isCharacterReference(ref))
  });
  const theme = stripCommandPrefix(context.request.prompt);
  const guidance = enhancementText(context, ["scene_summary", "visual_focus", "lighting_notes", "composition_notes", "template_guidance"]);
  const characterSentence = characterText
    ? `${characterText} 仅作为辅助角色参考，用于空间尺度锚点、站位锚点、行动调度锚点和互动关系参照，不作为人物主图，不喧宾夺主。`
    : "";
  const nonCharacterSentence = nonCharacterAuxiliaryText
    ? `其他辅助参考按其类型表达为局部物件、风格、光影或构图约束：${nonCharacterAuxiliaryText}，不得强行改写为角色尺度。`
    : "";
  const characterNegative = plan.characterAuxiliaryRefs.length
    ? "不要让辅助角色喧宾夺主，不要生成角色立绘式主图，"
    : "";
  return [
    `生成一套以 ${sceneName} 为主参考的影视级 / AIGC 场景多视图参考板。最终交付物围绕“${theme}”展开，必须是场景多机位、空间关系、现场光影和氛围参考板，不是单张场景美图，也不是人物主图。${sceneName} 是场景主参考，必须保持空间结构、区域布局、材质层次、结构细节、光影方向和空间纵深稳定一致。`,
    `${auxiliaryText ? `辅助参考包括 ${auxiliaryText}，所有辅助参考只能服务场景主交付物。` : ""}${characterSentence}${nonCharacterSentence}${guidance}`,
    "场景元素只做类别级补全：空间结构、区域布局、主要陈设、可见材质、关键区域、结构细节、光影方向、空间纵深、局部物件和环境元素。不要主动脑补具体物件，除非它来自原始提示词、reference 名称、reference 描述或合格增强信息。",
    `采用 3×3 或等价多视图 / 多机位 / 场景设定参考板结构：全景镜头展示 ${sceneName} 的整体空间关系；中景镜头展示关键区域和辅助参考的尺度关系；陈设特写展示主要陈设与局部物件；装饰 / 结构特写展示可见结构细节；材质特写展示表面质感和材质层次；关键区域 / 局部特写展示空间功能和行动锚点；俯视全景展示区域分布；平面布局图展示入口、动线、尺度和空间关系；分镜示意图展示现场调度、光线方向和镜头衔接。`,
    "整体风格为写实影视概念设计，画面清晰，空间信息稳定，主体关系明确，光影层次丰富，材质细节可辨。以场景为主，辅助参考为辅，重点服务场景资产设计、现场光影设计、多机位分镜参考和后续 AIGC 场景复用。",
    `严格遵守参考绑定，${sceneName} 是主参考，${auxiliaryText || "辅助参考"} 不得改变主交付物。不要混淆实体身份，不要改变参考绑定关系，不要新增未提供的参考对象，${characterNegative}不要出现文字、水印、标签、重复主体、畸形肢体、低清晰度、过度虚化、空间错乱或互相矛盾的场景结构。`
  ].filter(Boolean).join("\n\n");
}

function propMultiviewPrompt(context) {
  const plan = context.referencePlan;
  const prop = propMainRefs(plan);
  const name = namesText(prop, mentionFromRaw(context.request.prompt, "主道具"));
  const auxiliaryText = auxiliaryRefsText({ ...plan, auxiliaryRefs: plan.auxiliaryRefs.filter((ref) => !isSameRefList(ref, prop)) });
  const guidance = enhancementText(context, ["visual_focus", "composition_notes", "template_guidance"]);
  return [
    `生成一张道具多视图资产参考板，也是一套道具资产 / 多角度资产图，以 ${name} 作为道具主交付物，最终呈现道具结构、材质、纹样和多角度资产图，不是普通产品图，也不是单张道具美图。${name} 必须保持轮廓、体块、比例、连接结构、开合结构、边缘结构、可活动部件、装饰位置、局部细节和材质层次稳定一致。`,
    `${auxiliaryText ? `辅助参考包括 ${auxiliaryText}，角色或场景只能作为比例参照、使用语境、摆放关系或动作语境，不能改变道具主交付物属性。` : ""}${guidance}`,
    "画面必须覆盖整体视图、正面视图、侧面视图、背面视图、顶部 / 底部视图、结构拆解、材质特写、纹样 / 工艺特写、比例参照和使用场景参考。每个视图都服务于建模、绘制、材质还原和资产复用。",
    "重点展示道具轮廓、体块关系、尺寸比例、连接部位、边缘厚度、活动结构、装饰分布、表面纹理、磨损层次、材质差异和局部工艺。背景保持简洁，辅助对象只解释尺度和使用关系。",
    "不要生成角色立绘、场景多视图或故事板；不要改变主参考道具的核心外形，不要新增未提供的主道具，不要让人物或背景喧宾夺主，不要出现文字、水印、标签、比例错乱、材质混淆、结构前后矛盾、低清晰度或单一角度展示。"
  ].filter(Boolean).join("\n\n");
}

function storyboardPrompt(context) {
  const plan = context.referencePlan;
  const refsText = plan.allRefs.length ? `参考对象保持绑定稳定：${plan.allRefs.map((ref) => `${mention(ref, ref.entity_type || "对象")} 用作${roleUsageText(ref)}`).join("；")}。` : "";
  const shotCount = detectShotCount(context.request.prompt);
  const shotText = shotCount ? `如果输入中已有 shot 清单，右侧剧情宫格区必须保持原 ${shotCount} 个 shot 的数量、顺序和核心动作，只补景别、运镜、光影、布局和负向约束，不重拆、不重排、不合并、不删除。` : "右侧剧情宫格区根据实际剧情动作阶段自适应生成分镜数量，宫格数量等于实际 shot 数量。";
  const guidance = enhancementText(context, ["story_function", "action_stages", "lighting_notes", "composition_notes", "template_guidance"]);
  return [
    `生成一张影视级剧情故事板制作图，围绕“${stripCommandPrefix(context.request.prompt)}”制作剧情宫格电影分镜制作板。它不是普通漫画分镜，不是固定九宫格，不是单张剧情图。`,
    "画面必须包含左侧规划区和右侧剧情宫格区。左侧规划区包含场景走位示意图、氛围概念图、光影变化示意、空间关系、人物动线和镜头调度，用来说明分镜执行逻辑。",
    `${shotText}不要固定九宫格，不要固定 2×2，不要固定 3×3，不限制 shot 数量，不限制总时长。右侧每个剧情宫格都要清楚表达景别、构图、人物关系、动作阶段、光影变化、镜头调度和剧情推进。`,
    `${refsText}${guidance}如果输入是剧情段落、对白片段或原始剧本，则根据动作阶段自适应拆分；如果输入是半结构化分镜或完整 storyboard prompt，则保留用户原有核心结构并补足左侧规划区、右侧剧情宫格、镜头调度、光影和负向规则。`,
    "整体清晰可读，适合导演、分镜、美术和 AIGC 视频制作复用。不要把故事板做成场景 3×3 参考板，不要限制总时长，不要省略左侧规划区或右侧剧情宫格区，不要出现文字水印、无关标签、镜头顺序混乱、空间跳变、人物身份混淆、动作顺序错误或低清晰度。"
  ].filter(Boolean).join("\n\n");
}

export function validateOptimizedPrompt(prompt, context = {}) {
  const text = stringValue(prompt).trim();
  if (!text || countCjk(text) < PROMPT_MIN_CJK) throw optimizedPromptInvalid();
  for (const title of forbiddenPromptHeadings()) {
    if (text.includes(title)) throw optimizedPromptInvalid();
  }
  if (/RAGFlow|fallback|provider\s*payload|provider_internal_payload|final_prompt|compiled_prompt|enhancement|input_analysis|storyboard_processing/i.test(text)) {
    throw optimizedPromptInvalid();
  }

  const request = context.request || {};
  const plan = context.referencePlan || buildReferencePlan(context.binding || {});
  if (request.task_type === "text_image") validateTextImagePrompt(text);
  if (request.task_type === "image_reference") validateImageReferencePrompt(text, plan);
  if (request.task_type === "character_multiview") validateCharacterMultiviewPrompt(text, plan);
  if (request.task_type === "scene_multiview") validateSceneMultiviewPrompt(text, plan);
  if (request.task_type === "prop_multiview") validatePropMultiviewPrompt(text, plan);
  if (request.task_type === "storyboard") validateStoryboardPrompt(text);
  return text;
}

function validateTextImagePrompt(text) {
  if (/(必须采用 4 格横向布局|采用 3×3|左侧规划区和右侧剧情宫格区|道具多视图资产参考板|场景设定参考板结构)/u.test(text)) throw optimizedPromptInvalid();
}

function validateImageReferencePrompt(text, plan) {
  if (!/(基于参考图|参考图生成|保持参考|参考对象|关键视觉特征)/u.test(text)) throw optimizedPromptInvalid();
  for (const name of plan.primaryEntityNames.length ? plan.primaryEntityNames : plan.allEntityNames) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (/(必须采用 4 格横向布局|采用 3×3|左侧规划区和右侧剧情宫格区|道具多视图资产参考板|场景设定参考板结构)/u.test(text)) throw optimizedPromptInvalid();
}

function validateCharacterMultiviewPrompt(text, plan) {
  for (const name of requiredNames(plan.characterPrimaryRefs.length ? plan.characterPrimaryRefs : plan.characterRefs)) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (!/(人物多视角|四视图|角色设定图|人物一致性参考图)/u.test(text)) throw optimizedPromptInvalid();
  for (const word of ["4 格横向布局", "正面全身", "头部特写", "侧面全身", "背面全身", "头到脚", "鞋子", "A 字站姿", "手上无道具", "纯色背景"]) {
    if (!text.includes(word)) throw optimizedPromptInvalid();
  }
  if (/(场景多视图|道具多视图|剧情宫格|左侧规划区|右侧剧情宫格区)/u.test(text)) throw optimizedPromptInvalid();
}

function validateSceneMultiviewPrompt(text, plan = {}) {
  if (!/(场景多视图|多机位|多视图|现场光影参考图|场景设定参考板|场景设定板)/u.test(text)) throw optimizedPromptInvalid();
  for (const name of requiredNames(plan.scenePrimaryRefs.length ? plan.scenePrimaryRefs : plan.primaryRefs)) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  for (const name of plan.auxiliaryEntityNames || []) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (plan.characterAuxiliaryRefs?.length && !/(辅助角色参考|空间尺度|站位|调度|不作为人物主图|不喧宾夺主)/u.test(text)) throw optimizedPromptInvalid();
  const viewWords = ["全景", "中景", "特写", "俯视", "平面布局", "分镜", "材质", "光影"];
  if (viewWords.filter((word) => text.includes(word)).length < 5) throw optimizedPromptInvalid();
  if (/(角色四视图|道具多视图|剧情宫格|左侧规划区|右侧剧情宫格区)/u.test(text)) throw optimizedPromptInvalid();
}

function validatePropMultiviewPrompt(text, plan) {
  for (const name of requiredNames(propMainRefs(plan))) {
    if (!includesEntityName(text, name)) throw optimizedPromptInvalid();
  }
  if (!/(道具多视图|道具资产|多角度资产图|资产参考板)/u.test(text)) throw optimizedPromptInvalid();
  for (const word of ["正面", "侧面", "背面", "结构", "材质", "比例", "特写"]) {
    if (!text.includes(word)) throw optimizedPromptInvalid();
  }
  if (/(必须采用 4 格横向布局|场景设定参考板结构|左侧规划区和右侧剧情宫格区)/u.test(text)) throw optimizedPromptInvalid();
}

function validateStoryboardPrompt(text) {
  for (const word of ["故事板", "分镜", "剧情宫格", "左侧规划区", "右侧剧情宫格区"]) {
    if (!text.includes(word)) throw optimizedPromptInvalid();
  }
  if (!/(不固定九宫格|不要固定九宫格)/u.test(text)) throw optimizedPromptInvalid();
  if (!/(自适应|shot 数量|宫格数量等于实际 shot 数量)/u.test(text)) throw optimizedPromptInvalid();
  if (!/(不限制 shot 数量|不限制总时长)/u.test(text)) throw optimizedPromptInvalid();
  if (/采用 3×3 或等价多视图/u.test(text)) throw optimizedPromptInvalid();
}

export function buildPromptOptimizationResponse({ request, context, optimizedPrompt, traceId }) {
  const payload = {
    status: "succeeded",
    request_id: request.request_id,
    optimization_id: makeId("opt"),
    task_type: request.task_type,
    task_type_label: taskTypeLabel(request.task_type),
    generation_mode: context.referencePlan.generationMode,
    input: {
      prompt: request.prompt
    },
    optimized_prompt: optimizedPrompt,
    normalized: {
      entity_mentions: context.binding.entity_mentions,
      references_used: context.binding.references_used
    },
    warnings: context.binding.warnings,
    trace_id: traceId
  };
  assertNoForbiddenPublicFields(payload);
  return payload;
}

export function buildReferencePlan(input = {}) {
  const refs = Array.isArray(input.resolved_references)
    ? input.resolved_references
    : Array.isArray(input.references)
      ? input.references
      : [];
  const allRefs = refs.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const primaryRefs = allRefs.filter((ref) => ref.usage === "primary");
  const auxiliaryRefs = allRefs.filter((ref) => ref.usage === "auxiliary");
  const characterRefs = allRefs.filter(isCharacterReference);
  const sceneRefs = allRefs.filter(isSceneReference);
  const propRefs = allRefs.filter(isPropReference);
  const styleRefs = allRefs.filter(isStyleReference);
  const lightingRefs = allRefs.filter(isLightingReference);
  const compositionRefs = allRefs.filter(isCompositionReference);
  const characterPrimaryRefs = primaryRefs.filter(isCharacterReference);
  const characterAuxiliaryRefs = auxiliaryRefs.filter(isCharacterReference);
  const scenePrimaryRefs = primaryRefs.filter(isSceneReference);
  const sceneAuxiliaryRefs = auxiliaryRefs.filter(isSceneReference);
  const propPrimaryRefs = primaryRefs.filter(isPropReference);
  const propAuxiliaryRefs = auxiliaryRefs.filter(isPropReference);
  const styleAuxiliaryRefs = auxiliaryRefs.filter((ref) => isStyleReference(ref) || isLightingReference(ref) || isCompositionReference(ref));
  const entityMentions = input.entity_mentions || input.request?.entity_mentions || [];
  const unboundMentions = entityMentions.filter((mention) => mention.reference_status === "unbound");
  return {
    allRefs,
    primaryRefs,
    auxiliaryRefs,
    characterRefs,
    sceneRefs,
    propRefs,
    styleRefs,
    lightingRefs,
    compositionRefs,
    characterPrimaryRefs,
    characterAuxiliaryRefs,
    scenePrimaryRefs,
    sceneAuxiliaryRefs,
    propPrimaryRefs,
    propAuxiliaryRefs,
    styleAuxiliaryRefs,
    primaryEntityNames: uniqueNames(primaryRefs),
    auxiliaryEntityNames: uniqueNames(auxiliaryRefs),
    allEntityNames: uniqueNames(allRefs),
    entityMentions,
    resolvedReferences: allRefs,
    unboundMentions,
    generationMode: allRefs.length ? "image_to_image" : "text_to_image"
  };
}

function sceneMainRefs(plan) {
  if (plan.scenePrimaryRefs.length) return plan.scenePrimaryRefs;
  if (plan.primaryRefs.length) return plan.primaryRefs;
  if (plan.sceneRefs.length) return [plan.sceneRefs[0]];
  return [];
}

function characterMainRefs(plan) {
  if (plan.characterPrimaryRefs.length) return plan.characterPrimaryRefs;
  if (plan.primaryRefs.length) return plan.primaryRefs.filter(isCharacterReference);
  if (plan.characterRefs.length) return [plan.characterRefs[0]];
  if (plan.primaryRefs.length) return plan.primaryRefs;
  return [];
}

function propMainRefs(plan) {
  if (plan.propPrimaryRefs.length) return plan.propPrimaryRefs;
  if (plan.primaryRefs.length) return plan.primaryRefs.filter((ref) => isPropReference(ref) || isMaterialReference(ref) || isPatternReference(ref));
  if (plan.propRefs.length) return [plan.propRefs[0]];
  if (plan.primaryRefs.length) return plan.primaryRefs;
  return [];
}

function uniqueNames(refs) {
  const names = refs.map((ref) => stringValue(ref && ref.entity_name).trim()).filter(Boolean);
  return [...new Set(names)];
}

function requiredNames(refs) {
  return uniqueNames(refs || []);
}

function namesText(refs, fallback) {
  const names = uniqueNames(refs || []);
  if (!names.length) return fallback;
  return names.map((name) => name.startsWith("@") ? name : `@${name}`).join("、");
}

function auxiliaryRefsText(plan) {
  return (plan.auxiliaryRefs || [])
    .map((ref) => `${mention(ref, ref.entity_type || "辅助参考")}（${roleUsageText(ref)}${ref.description ? `，${ref.description}` : ""}）`)
    .join("、");
}

function isSameRefList(ref, refs) {
  return (refs || []).some((item) => item.reference_id === ref.reference_id);
}

function isSceneReference(ref) {
  return ref && (ref.entity_type === "scene" || ref.role === "scene_reference");
}

function isCharacterReference(ref) {
  return ref && (ref.entity_type === "character" || ref.role === "character_reference");
}

function isPropReference(ref) {
  return ref && (ref.entity_type === "prop" || ref.role === "prop_reference" || isMaterialReference(ref) || isPatternReference(ref));
}

function isMaterialReference(ref) {
  return ref && (ref.entity_type === "material" || ref.role === "material_reference");
}

function isPatternReference(ref) {
  return ref && (ref.entity_type === "pattern" || ref.role === "pattern_reference");
}

function isStyleReference(ref) {
  return ref && (ref.entity_type === "style" || ref.role === "style_reference");
}

function isLightingReference(ref) {
  return ref && (ref.entity_type === "lighting" || ref.role === "lighting_reference");
}

function isCompositionReference(ref) {
  return ref && (ref.entity_type === "composition" || ref.role === "composition_reference");
}

function includesEntityName(text, name) {
  const value = stringValue(name).trim();
  return Boolean(value && (text.includes(value) || text.includes(`@${value.replace(/^@/u, "")}`)));
}

function mention(ref, fallback) {
  const name = stringValue(ref && ref.entity_name).trim() || fallback;
  return name.startsWith("@") ? name : `@${name}`;
}

function mentionFromRaw(prompt, fallback) {
  const mentions = extractEntityMentions(prompt);
  return mentions[0]?.entity_name ? `@${mentions[0].entity_name}` : fallback;
}

function roleUsageText(ref) {
  if (!ref) return "视觉参考";
  if (ref.role === "scene_reference" && ref.usage === "primary") return "场景主参考";
  if (ref.role === "scene_reference") return "场景参考";
  if (ref.role === "character_reference" && ref.usage === "primary") return "角色主参考";
  if (ref.role === "character_reference" && ref.usage === "auxiliary") return "辅助角色参考、空间尺度和调度参照";
  if (ref.role === "character_reference") return "角色参考";
  if (ref.role === "prop_reference" && ref.usage === "primary") return "道具主参考";
  if (ref.role === "prop_reference") return "道具参考";
  if (ref.role === "material_reference") return "材质参考";
  if (ref.role === "pattern_reference") return "纹样参考";
  if (ref.role === "style_reference") return "风格参考";
  if (ref.role === "lighting_reference") return "光影参考";
  if (ref.role === "composition_reference") return "构图参考";
  return ref.usage === "primary" ? "主参考" : ref.usage === "auxiliary" ? "辅助参考" : "视觉参考";
}

function enhancementText(context, keys) {
  const enhancement = context.enhancement || {};
  const parts = [];
  for (const key of keys) {
    const value = enhancement[key];
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    if (Array.isArray(value)) {
      const values = value.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? Object.values(item).filter((v) => typeof v === "string").join("，") : "").filter(Boolean);
      if (values.length) parts.push(values.join("；"));
    }
  }
  return parts.length ? `${parts.join("。")}。` : "";
}

function detectShotCount(prompt) {
  const matches = stringValue(prompt).match(/(?:shot|镜头)\s*\d+/giu);
  return matches ? new Set(matches.map((item) => item.toLowerCase())).size : 0;
}

function findValuesByKey(value, key) {
  const out = [];
  walkValue(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (typeof node[key] === "string") out.push(node[key]);
  });
  return out;
}

function findUrls(value) {
  const out = [];
  walkValue(value, (node) => {
    if (typeof node !== "string") return;
    const matches = node.match(/https?:\/\/[^\s"'<>]+/giu);
    if (matches) out.push(...matches);
  });
  return out;
}

function walkValue(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walkValue(item, visitor);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkValue(item, visitor);
  }
}

function isRagflowErrorEnvelope(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  if (Array.isArray(json.choices)) return false;
  if (!Object.prototype.hasOwnProperty.call(json, "code")) return false;
  return Number(json.code) !== 0;
}

function extractPromptCandidates(json) {
  const candidates = [];
  const push = (value) => {
    if (typeof value === "string" && value.trim()) candidates.push(value.trim());
  };

  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  push(choice && choice.message && choice.message.content);
  push(choice && choice.delta && choice.delta.content);
  push(choice && choice.text);

  push(json && json.optimized_prompt);
  push(json && json.answer);
  push(json && json.content);
  push(json && json.message);
  push(json && json.response);
  push(json && json.data && json.data.optimized_prompt);
  push(json && json.data && json.data.answer);
  push(json && json.data && json.data.content);
  push(json && json.data && json.data.message);
  push(json && json.data && json.data.response);

  if (Object.keys(json || {}).length) candidates.push(JSON.stringify(json));
  return [...new Set(candidates)];
}

function unwrapCodeFence(value) {
  const text = stringValue(value).trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match ? match[1].trim() : text;
}

function parseJsonMaybe(value) {
  const text = stringValue(value).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function forbiddenPromptHeadings() {
  return [
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
  ];
}

function countCjk(value) {
  const matches = stringValue(value).match(/[\u3400-\u9fff]/gu);
  return matches ? matches.length : 0;
}

function optimizedPromptInvalid() {
  return new ImageApiError({
    statusCode: 422,
    status: "failed",
    errorCode: "OPTIMIZED_PROMPT_INVALID",
    message: "提示词优化结果不合格，请重新优化。"
  });
}

function stripCommandPrefix(prompt) {
  return stringValue(prompt).trim().replace(/^请?(生成|绘制|制作|设计)\s*/u, "").replace(/[。.\s]+$/u, "");
}
