export function extractEntityMentions(prompt) {
  const text = String(prompt || "");
  const raw = [];
  collectBracketMentions(text, raw);
  collectAtMentions(text, raw);
  raw.sort((a, b) => a.start - b.start || a.end - b.end);

  return raw.map((item, index) => ({
    mention_id: `m_${String(index + 1).padStart(3, "0")}`,
    marker: item.marker,
    entity_name: item.entity_name,
    start: item.start,
    end: item.end,
    reference_status: "unbound",
    matched_reference_ids: []
  }));
}

function collectBracketMentions(text, out) {
  const regex = /\[([^\[\]\r\n]{1,80})\]/gu;
  for (const match of text.matchAll(regex)) {
    const entityName = cleanEntityName(match[1]);
    if (!entityName) continue;
    out.push({
      marker: match[0],
      entity_name: entityName,
      start: match.index,
      end: match.index + match[0].length
    });
  }
}

function collectAtMentions(text, out) {
  const regex = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_\-\u4e00-\u9fff·]{1,80})/gu;
  for (const match of text.matchAll(regex)) {
    const prefix = match[1] || "";
    const rawEntity = trimAtEntity(match[2]);
    const entityName = cleanEntityName(rawEntity);
    if (!entityName) continue;
    const marker = `@${rawEntity}`;
    const start = match.index + prefix.length;
    out.push({
      marker,
      entity_name: entityName,
      start,
      end: start + marker.length
    });
  }
}

function trimAtEntity(value) {
  return String(value || "").replace(/[，。！？；：、,.!?;:)\]）】》」』"'`]+$/u, "");
}

function cleanEntityName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
