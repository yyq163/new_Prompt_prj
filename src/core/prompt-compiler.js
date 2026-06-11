import { taskTypeLabel, roleLabel } from "./labels.js";

const COMMON_NEGATIVE = "禁止文字、标签、水印、错误绑定、角色漂移、场景漂移、参考图串用、低清晰度和多余肢体。";

export function compilePrompt({ request, binding, enhancement = null }) {
  const referencesDescription = describeReferences(binding.resolved_references);
  const base = [
    `任务类型：${taskTypeLabel(request.task_type)}。`,
    `用户原始需求：${request.prompt}`,
    referencesDescription ? `参考绑定：${referencesDescription}` : "参考绑定：无参考图，按纯文生图执行。",
    outputDescription(request.output)
  ];

  let taskBlock = "";
  let storyboardPath = "";
  switch (request.task_type) {
    case "text_image":
      taskBlock = textImageTemplate(enhancement);
      break;
    case "image_reference":
      taskBlock = imageReferenceTemplate(enhancement);
      break;
    case "character_multiview":
      taskBlock = characterMultiviewTemplate(enhancement);
      break;
    case "scene_multiview":
      taskBlock = sceneMultiviewTemplate(enhancement);
      break;
    case "prop_multiview":
      taskBlock = propMultiviewTemplate(enhancement);
      break;
    case "storyboard": {
      const storyboard = storyboardTemplate(request, enhancement, referencesDescription);
      taskBlock = storyboard.text;
      storyboardPath = storyboard.path;
      break;
    }
    default:
      taskBlock = textImageTemplate(enhancement);
  }

  const compiledPrompt = [
    ...base,
    taskBlock,
    `负向规则：${COMMON_NEGATIVE}`
  ].filter(Boolean).join("\n\n");

  return {
    compiled_prompt: compiledPrompt,
    storyboard_path: storyboardPath,
    references_used: binding.references_used
  };
}

function describeReferences(references) {
  if (!references || !references.length) return "";
  return references.map((ref) => {
    const description = ref.description ? `，说明：${ref.description}` : "";
    return `${ref.entity_name}=${roleLabel(ref.role)}，reference_id=${ref.reference_id}${description}`;
  }).join("；");
}

function outputDescription(output) {
  return `输出：${output.count} 张，比例 ${output.aspect_ratio}，质量 ${output.quality}，返回 URL。`;
}

function enhancementLine(enhancement, keys) {
  if (!enhancement) return "";
  return keys
    .map((key) => stringifyEnhancementValue(key, enhancement[key]))
    .filter(Boolean)
    .join("\n");
}

function stringifyEnhancementValue(key, value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return `${key}：${value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("；")}`;
  if (typeof value === "object") return `${key}：${JSON.stringify(value)}`;
  return `${key}：${String(value)}`;
}

function textImageTemplate(enhancement) {
  return [
    "模板：根据用户原始需求生成完整画面，保持主体清晰、空间关系明确、光影稳定。",
    enhancementLine(enhancement, ["visual_focus", "lighting_notes", "composition_notes", "negative_notes"])
  ].filter(Boolean).join("\n");
}

function imageReferenceTemplate(enhancement) {
  return [
    "模板：严格参考已绑定图片 URL 所代表的视觉对象，保持主体身份、结构、材质、比例和风格一致。",
    enhancementLine(enhancement, ["visual_focus", "lighting_notes", "composition_notes", "negative_notes"])
  ].filter(Boolean).join("\n");
}

function characterMultiviewTemplate(enhancement) {
  return [
    "模板：按用户原始需求生成角色设定参考图，保持人物身份、服饰、比例和参考绑定一致。",
    "本地 fallback 只保留一致性与安全约束；具体视图数量、视角、姿态、背景和版式必须来自用户 prompt 或 RAGFlow knowledge enhancement。",
    enhancementLine(enhancement, ["visual_focus", "lighting_notes", "composition_notes", "negative_notes", "missing_constraints"])
  ].filter(Boolean).join("\n");
}

function sceneMultiviewTemplate(enhancement) {
  return [
    "模板：按用户原始需求生成场景参考图，保持空间身份、角色/道具关系、光影方向和参考绑定一致。",
    "本地 fallback 不预设固定版式、机位数量或空间拆解方式；具体专业结构必须来自用户 prompt 或 RAGFlow knowledge enhancement。",
    enhancementLine(enhancement, ["scene_summary", "visual_focus", "lighting_notes", "composition_notes", "negative_notes", "missing_constraints"])
  ].filter(Boolean).join("\n");
}

function propMultiviewTemplate(enhancement) {
  return [
    "模板：按用户原始需求生成道具资产参考图，保持道具身份、结构、材质、比例和参考绑定一致。",
    "本地 fallback 不预设固定视角、细节拆解或使用状态；具体专业结构必须来自用户 prompt 或 RAGFlow knowledge enhancement。",
    enhancementLine(enhancement, ["visual_focus", "lighting_notes", "composition_notes", "negative_notes", "missing_constraints"])
  ].filter(Boolean).join("\n");
}

function storyboardTemplate(request, enhancement, referencesDescription) {
  if (!enhancement) {
    return {
      path: "fallback_generic_storyboard_minimal",
      text: [
        "模板：以用户原始需求为主体生成故事板分镜参考图，保持角色、场景、动作顺序和参考绑定一致。",
        referencesDescription ? `追加参考绑定说明：${referencesDescription}` : "",
        "本地 fallback 不默认固定 shot 数量、不默认固定总时长、不默认固定九宫格、四宫格、2×2 或 3×3。",
        "具体分镜结构、布局分区、镜头计划和画面组织必须来自用户 prompt 或 RAGFlow knowledge enhancement。"
      ].filter(Boolean).join("\n")
    };
  }

  if (Array.isArray(enhancement.normalized_shot_plan)) {
    return {
      path: "normalized_existing_shots",
      text: [
        "模板：按已有分镜/shot 清单规范化，保留用户原 shot 数量、顺序和核心动作。",
        stringifyEnhancementValue("normalized_shot_plan", enhancement.normalized_shot_plan),
        enhancementLine(enhancement, ["lighting_notes", "composition_notes", "negative_notes", "missing_constraints"]),
        "具体布局与画面组织按 RAGFlow knowledge enhancement 执行，不在本地固定模板。"
      ].filter(Boolean).join("\n")
    };
  }

  if (enhancement.missing_constraints || enhancement.storyboard_processing === "preserve_full_prompt") {
    return {
      path: "preserve_full_prompt",
      text: [
        "模板：保留用户完整故事板提示词为主体，不重写原提示词。",
        stringifyEnhancementValue("missing_constraints", enhancement.missing_constraints),
        enhancementLine(enhancement, ["lighting_notes", "composition_notes", "negative_notes"]),
        "只追加参考绑定说明、RAGFlow knowledge enhancement 中明确给出的约束和通用负向规则。"
      ].filter(Boolean).join("\n")
    };
  }

  return {
    path: "script_to_storyboard",
    text: [
      "模板：将剧情/剧本/对白转换为故事板分镜参考图。",
      enhancementLine(enhancement, ["scene_summary", "story_function", "action_stages", "shot_plan", "lighting_notes", "composition_notes", "negative_notes", "missing_constraints"]),
      "具体 shot 数量、布局分区和画面组织按 RAGFlow knowledge enhancement 执行，不在本地固定模板。"
    ].filter(Boolean).join("\n")
  };
}

export function inferStoryboardPathForTest(request, enhancement) {
  return storyboardTemplate(request, enhancement, "").path;
}
