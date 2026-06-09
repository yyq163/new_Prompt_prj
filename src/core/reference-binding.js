import { fail, clarification } from "./errors.js";
import { roleLabel, VALID_REFERENCE_ROLES, VALID_USAGES } from "./labels.js";

const REQUIRED_ROLE_BY_TASK = Object.freeze({
  image_reference: null,
  character_multiview: ["face_reference", "character_reference"],
  scene_multiview: ["scene_reference", "lighting_reference", "composition_reference"],
  prop_multiview: ["prop_reference", "material_reference", "ornament_reference"]
});

export function resolveReferences(request, entityMentions) {
  const references = validateReferences(request);
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

  return {
    entity_mentions: normalizedMentions,
    resolved_references: references,
    references_used: references.map(publicReference),
    warnings
  };
}

function validateReferences(request) {
  const references = request.references || [];
  if (request.task_type === "text_image" && references.length) {
    fail("REFERENCES_NOT_ALLOWED", "text_image 不允许传 references。");
  }

  const requiredRole = REQUIRED_ROLE_BY_TASK[request.task_type];
  if (request.task_type === "image_reference" && !references.length) {
    fail("REFERENCE_REQUIRED", "当前任务类型需要至少一张参考图。");
  }

  const seenIds = new Set();
  const groups = new Map();
  const items = references.map((ref, index) => {
    if (!ref.reference_id) fail("INVALID_REQUEST_SCHEMA", "reference_id 不能为空。");
    if (seenIds.has(ref.reference_id)) {
      fail("DUPLICATE_REFERENCE_ID", "参考图 ID 重复，请检查上传的参考图。");
    }
    seenIds.add(ref.reference_id);
    if (!ref.entity_name) fail("INVALID_REQUEST_SCHEMA", "reference.entity_name 不能为空。");
    if (!VALID_REFERENCE_ROLES.includes(ref.role)) {
      fail("INVALID_REFERENCE_ROLE", "参考图 role 不合法。");
    }
    if (ref.usage && !VALID_USAGES.includes(ref.usage)) {
      fail("INVALID_REQUEST_SCHEMA", "reference.usage 必须是 primary 或 auxiliary。");
    }
    if (!/^https?:\/\//i.test(ref.url)) {
      fail("INVALID_REQUEST_SCHEMA", "reference.url 必须是 http 或 https URL。");
    }
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
    if (group.length === 1 && !group[0].usage) {
      group[0].usage = "primary";
      continue;
    }
    if (group.length > 1 && group.some((item) => !item.usage)) {
      fail("DUPLICATE_ENTITY_ROLE_REFERENCE", `「${group[0].entity_name}」存在多张${roleLabel(group[0].role)}，请显式指定 primary/auxiliary。`);
    }
    if (group.filter((item) => item.usage === "primary").length > 1) {
      fail("MULTIPLE_PRIMARY_REFERENCES", `「${group[0].entity_name}」存在多张主参考图，请只保留一张 primary。`);
    }
  }

  const normalized = items.map((item) => ({
    ...item,
    role_label: roleLabel(item.role)
  }));

  if (requiredRole && normalized.length) {
    const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!normalized.some((item) => item.usage === "primary" && allowedRoles.includes(item.role))) {
      fail("REFERENCE_REQUIRED", `当前任务类型需要${allowedRoles.map(roleLabel).join("或")}作为 primary。`);
    }
  }

  return normalized.sort((a, b) => a.order - b.order);
}

export function publicReference(ref) {
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
