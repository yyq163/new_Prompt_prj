export function parseRuntimeConfigText(text) {
  const source = String(text || "").trim();
  if (!source) return {};

  const direct = tryParseJsonObject(source);
  if (direct) return direct;

  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    const parsed = tryParseJsonObject(fenced[1]);
    if (parsed) return parsed;
  }

  const objectText = extractFirstJsonObject(source);
  if (objectText) {
    const parsed = tryParseJsonObject(objectText);
    if (parsed) return parsed;
  }

  return {};
}

function tryParseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}
