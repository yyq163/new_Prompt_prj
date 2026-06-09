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
    const usage = ref.usage ? `，${ref.usage}` : "";
    const description = ref.description ? `，说明：${ref.description}` : "";
    return `${ref.entity_name}=${roleLabel(ref.role)}${usage}，reference_id=${ref.reference_id}${description}`;
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
    "模板：生成 4 格横向角色设定图：1 正面全身站姿；2 正面头部特写；3 侧面全身站姿；4 背面全身站姿。",
    "硬要求：完整头到脚，鞋子可见，A 字站姿，手上无道具，头部特写只能一个，纯色背景。",
    "禁止：文字/标签/水印/多个头部特写/缺侧面/缺背面。",
    enhancementLine(enhancement, ["visual_focus", "lighting_notes", "composition_notes", "negative_notes"])
  ].filter(Boolean).join("\n");
}

function sceneMultiviewTemplate(enhancement) {
  return [
    "模板：生成场景空间、现场光影、调度和多机位参考板。人物只作为现场比例、动作、调度和光影锚点，不改变场景多视图交付物属性。",
    "输出应呈现场景主参考的空间结构、入口/纵深/遮挡关系、主要光源和可拍摄机位。",
    enhancementLine(enhancement, ["scene_summary", "visual_focus", "lighting_notes", "composition_notes", "negative_notes"])
  ].filter(Boolean).join("\n");
}

function propMultiviewTemplate(enhancement) {
  return [
    "模板：生成道具资产多视图、结构、材质和纹样参考板。角色或场景只作为比例和使用语境，不改变道具主交付物属性。",
    "输出应包含正面、侧面、背面、细节材质和使用状态。",
    enhancementLine(enhancement, ["visual_focus", "lighting_notes", "composition_notes", "negative_notes"])
  ].filter(Boolean).join("\n");
}

function storyboardTemplate(request, enhancement, referencesDescription) {
  if (!enhancement) {
    return {
      path: "fallback_generic_storyboard",
      text: [
        "模板：以用户原始需求为主体生成剧情宫格电影分镜制作板。",
        referencesDescription ? `追加参考绑定说明：${referencesDescription}` : "",
        "布局：左侧规划区包含场景走位示意图、氛围概念图、光影变化示意；右侧剧情宫格区按剧情动作阶段自适应排版。",
        "禁止固定九宫格、固定四宫格、2x2 或 3x3；禁止文字遮挡主体、角色漂移、场景漂移、动作顺序错误。"
      ].filter(Boolean).join("\n")
    };
  }

  if (Array.isArray(enhancement.normalized_shot_plan)) {
    return {
      path: "normalized_existing_shots",
      text: [
        "模板：按已有分镜/shot 清单规范化，保留用户原 shot 数量、顺序和核心动作。",
        stringifyEnhancementValue("normalized_shot_plan", enhancement.normalized_shot_plan),
        enhancementLine(enhancement, ["lighting_notes", "composition_notes", "negative_notes"]),
        "布局：左侧规划区包含场景走位、氛围概念、光影变化；右侧按原 shot 顺序呈现。"
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
        "只追加参考绑定说明、布局硬约束、左侧规划区要求、右侧剧情宫格要求和负向规则。"
      ].filter(Boolean).join("\n")
    };
  }

  return {
    path: "script_to_storyboard",
    text: [
      "模板：将剧情/剧本/对白转换为剧情宫格电影分镜制作板。",
      enhancementLine(enhancement, ["scene_summary", "story_function", "action_stages", "shot_plan", "lighting_notes", "composition_notes", "negative_notes"]),
      "布局：左侧规划区包含场景走位、氛围概念、光影变化；右侧按剧情动作阶段自适应排版。"
    ].filter(Boolean).join("\n")
  };
}

export function inferStoryboardPathForTest(request, enhancement) {
  return storyboardTemplate(request, enhancement, "").path;
}
