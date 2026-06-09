import { fail, clarification } from "./errors.js";
import { roleLabel, VALID_REFERENCE_ROLES } from "./labels.js";

export function resolveReferences(request, entityMentions) {
  const references = validateReferences(request);
  const warnings = taskReferenceWarnings(request, references);
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
  if (request.task_type === "image_reference" && !references.length) {
    fail("REFERENCE_REQUIRED", "当前任务类型需要至少一张参考图。");
  }

  const seenIds = new Set();
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
    if (!/^https?:\/\//i.test(ref.url)) {
      fail("INVALID_REQUEST_SCHEMA", "reference.url 必须是 http 或 https URL。");
    }
    return {
      ...ref,
      order: Number.isFinite(Number(ref.order)) ? Number(ref.order) : index + 1,
      role_label: roleLabel(ref.role)
    };
  });

  return items.sort((a, b) => a.order - b.order);
}

function taskReferenceWarnings(request, references) {
  if (!references.length) {
    if (request.task_type === "character_multiview") {
      return [{
        code: "CHARACTER_REFERENCE_MISSING",
        message: "人物多视角图未提供人物脸部或角色参考图，人物一致性将主要依赖文本描述。"
      }];
    }
    if (request.task_type === "scene_multiview") {
      return [{
        code: "SCENE_REFERENCE_MISSING",
        message: "场景多视图图未提供场景参考图，空间一致性将主要依赖文本描述。"
      }];
    }
    if (request.task_type === "prop_multiview") {
      return [{
        code: "PROP_REFERENCE_MISSING",
        message: "道具多视图图未提供道具参考图，道具一致性将主要依赖文本描述。"
      }];
    }
  }

  if (request.task_type === "character_multiview" && !references.some(isCharacterOrFaceReference)) {
    return [{
      code: "CHARACTER_REFERENCE_MISSING",
      message: "人物多视角图未提供人物脸部或角色参考图，人物一致性将主要依赖文本描述。"
    }];
  }
  if (request.task_type === "scene_multiview" && !references.some(isSceneReference)) {
    return [{
      code: "SCENE_REFERENCE_MISSING",
      message: "场景多视图图未提供场景参考图，空间一致性将主要依赖文本描述。"
    }];
  }
  if (request.task_type === "prop_multiview" && !references.some(isPropReference)) {
    return [{
      code: "PROP_REFERENCE_MISSING",
      message: "道具多视图图未提供道具参考图，道具一致性将主要依赖文本描述。"
    }];
  }
  return [];
}

export function publicReference(ref) {
  return {
    reference_id: ref.reference_id,
    entity_name: ref.entity_name,
    entity_type: ref.entity_type,
    role: ref.role,
    role_label: roleLabel(ref.role),
    display_name: ref.display_name || "",
    order: ref.order
  };
}

function isCharacterOrFaceReference(ref) {
  return ref && (
    ref.entity_type === "character" ||
    ref.role === "character_reference" ||
    ref.role === "face_reference"
  );
}

function isSceneReference(ref) {
  return ref && (ref.entity_type === "scene" || ref.role === "scene_reference");
}

function isPropReference(ref) {
  return ref && (
    ref.entity_type === "prop" ||
    ref.role === "prop_reference" ||
    ref.role === "material_reference" ||
    ref.role === "ornament_reference"
  );
}
