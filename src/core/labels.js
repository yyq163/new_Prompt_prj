export const TASK_TYPE_LABELS = Object.freeze({
  text_image: "文生图",
  image_reference: "参考图生图",
  character_multiview: "角色多视图图",
  scene_multiview: "场景多视图图",
  prop_multiview: "道具多视图图",
  storyboard: "故事板分镜图"
});

export const ROLE_LABELS = Object.freeze({
  character_reference: "角色参考图",
  scene_reference: "场景参考图",
  prop_reference: "道具参考图",
  material_reference: "材质参考图",
  pattern_reference: "纹样参考图",
  style_reference: "风格参考图",
  composition_reference: "构图参考图",
  lighting_reference: "光影参考图",
  storyboard_reference: "故事板参考图"
});

export const ENTITY_TYPE_LABELS = Object.freeze({
  character: "角色",
  scene: "场景",
  prop: "道具",
  style: "风格",
  other: "其他"
});

export const VALID_TASK_TYPES = Object.freeze(Object.keys(TASK_TYPE_LABELS));
export const VALID_REFERENCE_ROLES = Object.freeze(Object.keys(ROLE_LABELS));
export const VALID_USAGES = Object.freeze(["primary", "auxiliary"]);

export function taskTypeLabel(taskType) {
  return TASK_TYPE_LABELS[taskType] || taskType;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}
