import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(join(import.meta.dirname, ".."));
const HTML_FILE = resolve(ROOT, process.env.IMAGE_HTML_FILE || "ai-image-generator.html");
const CONFIG_FILE = resolve(ROOT, process.env.RUNTIME_CONFIG_FILE || "../真实配置_toapis.md");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const OWNER_COOKIE = "ai_image_owner";
const POLL_INTERVAL_SECONDS = 2;
const MAX_BODY_BYTES = parseBytes(process.env.MAX_BODY_SIZE || "50mb");
const REFERENCE_TTL_MS = clampInt(process.env.REFERENCE_TTL_MINUTES, 1, 240, 30) * 60 * 1000;
const PROMPT_IMAGE_BACKEND_DEFAULT_PATH = "/api/v1/image-generations";
const PROMPT_IMAGE_BACKEND_DEFAULT_TIMEOUT_SECONDS = 120;
const VALID_V36_TASK_TYPES = new Set(["text_image", "image_reference", "character_multiview", "scene_multiview", "prop_multiview", "storyboard"]);
const VALID_V36_REFERENCE_ROLES = new Set(["face_reference", "character_reference", "outfit_reference", "hair_reference", "prop_reference", "scene_reference", "style_reference", "composition_reference", "lighting_reference", "material_reference", "ornament_reference", "storyboard_reference"]);
const VALID_V36_ENTITY_TYPES = new Set(["character", "scene", "prop", "outfit", "hair", "material", "ornament", "style", "lighting", "composition", "storyboard", "other"]);
const VALID_V36_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);
const VALID_V36_QUALITIES = new Set(["standard", "high"]);
const VALID_V36_LANGUAGES = new Set(["zh-CN"]);

const referenceImages = new Map();
let runtimeConfig = await loadRuntimeConfig();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (error && typeof error.status === "number") {
      return sendJson(response, error.status, {
        error: {
          code: error.code || "request_failed",
          message: error.message || "请求失败。"
        }
      });
    }
    console.error("[gateway] internal error", {
      message: error && error.message ? error.message : String(error)
    });
    sendJson(response, 500, {
      error: {
        code: "internal_error",
        message: "网关内部错误。"
      }
    });
  }
});

server.listen(PORT, HOST, () => {
  const config = getRuntimeConfig();
  console.log(`[gateway] listening on http://${HOST}:${PORT} backend=${hasPromptImageBackendConfig(config) ? "configured" : "missing"}`);
  console.log(`[gateway] runtime config ${CONFIG_FILE}`);
});

setInterval(cleanExpiredRecords, 60_000).unref();

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    return serveHtml(response);
  }

  if (request.method === "GET" && (url.pathname === "/config" || url.pathname === "/peizhi")) {
    return serveConfigPage(request, response);
  }

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204, {
      "Cache-Control": "public, max-age=86400"
    });
    return response.end();
  }

  if (request.method === "GET" && url.pathname === "/api/runtime") {
    const { ownerToken, isNewOwner } = ensureOwner(request);
    if (isNewOwner) setOwnerCookie(response, ownerToken);
    const config = getRuntimeConfig();
    return sendJson(response, 200, {
      service: request.headers.host || `${HOST}:${PORT}`,
      mode: "live",
      imageHostMode: config.imageHostMode,
      promptImageBackendConfigured: hasPromptImageBackendConfig(config),
      pollIntervalSeconds: POLL_INTERVAL_SECONDS
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return sendJson(response, 200, configResponse(request));
  }

  if (request.method === "POST" && url.pathname === "/api/config") {
    const body = await readJson(request);
    runtimeConfig = sanitizeRuntimeConfig(body);
    await saveRuntimeConfig(runtimeConfig);
    return sendJson(response, 200, {
      ok: true,
      message: "已保存并生效。",
      config: configResponse(request).config
    });
  }

  if (request.method === "POST" && url.pathname === "/api/reload-config") {
    runtimeConfig = await loadRuntimeConfig();
    return sendJson(response, 200, {
      ok: true,
      message: "已重新加载。",
      config: configResponse(request).config
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/image-generations") {
    const body = await readFinalImageJson(request);
    if (body.error) {
      return sendJson(response, 400, finalImageError("INVALID_REQUEST_SCHEMA", body.error.message, 400).payload);
    }
    const result = await handlePromptBackendImageGeneration(body.value, request);
    return sendJson(response, result.statusCode, result.payload);
  }

  if (request.method === "POST" && url.pathname === "/api/image-jobs") {
    return sendJson(response, 410, legacyImageJobsDisabledPayload());
  }

  const jobMatch = url.pathname.match(/^\/api\/image-jobs\/([^/]+)$/);
  if (request.method === "GET" && jobMatch) {
    return sendJson(response, 410, legacyImageJobsDisabledPayload());
  }

  if (request.method === "POST" && url.pathname === "/api/reference-images") {
    const { ownerToken, isNewOwner } = ensureOwner(request);
    if (isNewOwner) setOwnerCookie(response, ownerToken);
    return sendJson(response, 200, await uploadReferenceFromRequest(request, ownerToken, request.headers.host || `${HOST}:${PORT}`));
  }

  const referenceMatch = url.pathname.match(/^\/api\/reference-images\/([^/]+)$/);
  if (request.method === "GET" && referenceMatch) {
    return serveReferenceImage(response, decodeURIComponent(referenceMatch[1]));
  }

  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "未找到资源。"
    }
  });
}

async function serveHtml(response) {
  const html = await readFile(HTML_FILE, "utf8");
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

async function handlePromptBackendImageGeneration(body, request) {
  const validation = normalizeFinalImageRequest(body);
  if (validation.error) {
    return finalImageError(validation.error.code, validation.error.message, validation.error.statusCode || 400);
  }

  const backend = promptImageBackendConfig(request);
  if (!backend.baseUrl) {
    return finalImageError("PROMPT_IMAGE_BACKEND_NOT_CONFIGURED", "提示词优化生图后端未配置。", 503);
  }
  if (isSelfReferentialBackend(backend.baseUrl, request)) {
    return finalImageError("PROMPT_IMAGE_BACKEND_SELF_REFERENCE", "提示词优化生图后端不能指向 ai-tu gateway 自身。", 400);
  }

  let payload;
  try {
    payload = await postPromptImageBackend(validation.request, backend);
  } catch (error) {
    if (error && error.name === "AbortError") {
      return finalImageError("PROMPT_IMAGE_BACKEND_TIMEOUT", "生成超时，请稍后重试。", 504);
    }
    return finalImageError("PROMPT_IMAGE_BACKEND_UNAVAILABLE", "生图服务暂时不可用，请稍后重试。", 502);
  }

  if (payload && payload.__backendError) {
    return whitelistPromptBackendError(payload.statusCode, payload.payload);
  }

  return whitelistPromptBackendResponse(payload);
}

function normalizeFinalImageRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalidFinalRequest("INVALID_REQUEST_SCHEMA", "请求体必须是 JSON 对象。");
  }
  const taskType = stringValue(body.task_type).trim();
  if (!VALID_V36_TASK_TYPES.has(taskType)) {
    return invalidFinalRequest("UNSUPPORTED_TASK_TYPE", "不支持的 task_type。");
  }
  const prompt = stringValue(body.prompt).trim();
  if (!prompt) {
    return invalidFinalRequest("PROMPT_REQUIRED", "prompt 不能为空。");
  }
  if (body.references != null && !Array.isArray(body.references)) {
    return invalidFinalRequest("INVALID_REQUEST_SCHEMA", "references 必须是数组。");
  }
  const references = Array.isArray(body.references)
    ? body.references.map((item, index) => normalizeFinalReference(item, index))
    : [];
  const badReference = references.find((item) => item.error);
  if (badReference) return invalidFinalRequest(badReference.error.code, badReference.error.message);
  if (taskType === "text_image" && references.length) {
    return invalidFinalRequest("REFERENCES_NOT_ALLOWED", "text_image 不允许传 references。");
  }
  if (taskType !== "text_image" && !references.length) {
    return invalidFinalRequest("REFERENCE_REQUIRED", "当前任务类型需要至少一张参考图。");
  }
  const seenReferenceIds = new Set();
  for (const item of references) {
    const referenceId = item.reference.reference_id;
    if (!referenceId) {
      return invalidFinalRequest("REFERENCE_ID_REQUIRED", "reference_id 不能为空。");
    }
    if (seenReferenceIds.has(referenceId)) {
      return invalidFinalRequest("DUPLICATE_REFERENCE_ID", "参考图 ID 重复，请检查上传的参考图。");
    }
    seenReferenceIds.add(referenceId);
  }

  const output = normalizeFinalOutput(body.output);
  if (output.error) return invalidFinalRequest(output.error.code, output.error.message);
  const referencePolicy = normalizeFinalReferencePolicy(body.reference_policy);

  return {
    request: {
      task_type: taskType,
      prompt,
      references: references.map((item) => item.reference),
      reference_policy: referencePolicy,
      output: output.value
    }
  };
}

function normalizeFinalReference(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { error: { code: "INVALID_REQUEST_SCHEMA", message: `第 ${index + 1} 个 reference 必须是对象。` } };
  }
  const role = stringValue(item.role).trim();
  const entityType = stringValue(item.entity_type).trim();
  if (!VALID_V36_ENTITY_TYPES.has(entityType)) {
    return { error: { code: "REFERENCE_ENTITY_TYPE_INVALID", message: "reference.entity_type 不合法。" } };
  }
  if (!VALID_V36_REFERENCE_ROLES.has(role)) {
    return { error: { code: "INVALID_REFERENCE_ROLE", message: "参考图 role 不合法。" } };
  }
  if (!stringValue(item.entity_name).trim()) {
    return { error: { code: "REFERENCE_ENTITY_NAME_REQUIRED", message: "reference.entity_name 不能为空。" } };
  }
  const url = stringValue(item.url).trim();
  if (!isAbsoluteHttpUrl(url)) {
    return { error: { code: "REFERENCE_URL_INVALID", message: "reference.url 只支持 http 或 https URL。" } };
  }
  return {
    reference: {
      reference_id: stringValue(item.reference_id || item.referenceId).trim(),
      entity_name: stringValue(item.entity_name).trim(),
      entity_type: entityType,
      role,
      url,
      mime_type: stringValue(item.mime_type).trim(),
      display_name: stringValue(item.display_name).trim(),
      description: stringValue(item.description).trim(),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1
    }
  };
}

function isAbsoluteHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
}

function normalizeFinalReferencePolicy(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    unbound_entity: source.unbound_entity === "block" ? "block" : "warn"
  };
}

function normalizeFinalOutput(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawCount = source.count == null || source.count === "" ? 1 : Number(source.count);
  if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > 4) {
    return { error: { code: "INVALID_REQUEST_SCHEMA", message: "output.count 必须是 1 到 4 的整数。" } };
  }
  const count = rawCount;
  const aspectRatio = stringValue(source.aspect_ratio || "1:1").trim();
  const quality = stringValue(source.quality || "high").trim();
  const language = stringValue(source.language || "zh-CN").trim();
  const returnFormat = stringValue(source.return_format || "url").trim();
  if (!VALID_V36_ASPECT_RATIOS.has(aspectRatio)) {
    return { error: { code: "INVALID_REQUEST_SCHEMA", message: "output.aspect_ratio 不合法。" } };
  }
  if (!VALID_V36_QUALITIES.has(quality)) {
    return { error: { code: "INVALID_REQUEST_SCHEMA", message: "output.quality 不合法。" } };
  }
  if (!VALID_V36_LANGUAGES.has(language)) {
    return { error: { code: "INVALID_REQUEST_SCHEMA", message: "output.language 不合法。" } };
  }
  if (returnFormat !== "url") {
    return { error: { code: "INVALID_REQUEST_SCHEMA", message: "output.return_format 只支持 url。" } };
  }
  return {
    value: {
      count,
      aspect_ratio: aspectRatio,
      quality,
      return_format: "url",
      language
    }
  };
}

function invalidFinalRequest(code, message, statusCode = 400) {
  return { error: { code, message, statusCode } };
}

function promptImageBackendConfig(request) {
  const config = getRuntimeConfig();
  const path = stringValue(
    process.env.PROMPT_IMAGE_BACKEND_GENERATION_PATH || config.promptImageBackendGenerationPath
  ).trim() || PROMPT_IMAGE_BACKEND_DEFAULT_PATH;
  return {
    baseUrl: stringValue(process.env.PROMPT_IMAGE_BACKEND_BASE_URL || config.promptImageBackendBaseUrl).trim().replace(/\/+$/, ""),
    path: path.startsWith("/") ? path : `/${path}`,
    apiKey: stringValue(process.env.PROMPT_IMAGE_BACKEND_API_KEY || config.promptImageBackendApiKey).trim(),
    timeoutSeconds: clampInt(
      process.env.PROMPT_IMAGE_BACKEND_TIMEOUT_SECONDS || config.promptImageBackendTimeoutSeconds,
      1,
      900,
      PROMPT_IMAGE_BACKEND_DEFAULT_TIMEOUT_SECONDS
    ),
    requestHost: request.headers.host || `${HOST}:${PORT}`
  };
}

function isSelfReferentialBackend(baseUrl, request) {
  let backend;
  try {
    backend = new URL(baseUrl);
  } catch {
    return false;
  }
  const requestHost = request.headers.host || `${HOST}:${PORT}`;
  const gatewayCandidates = [
    `http://${requestHost}`,
    `https://${requestHost}`,
    `http://${HOST}:${PORT}`,
    `https://${HOST}:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`
  ];
  return gatewayCandidates.some((candidate) => {
    try {
      const parsed = new URL(candidate);
      return sameGatewayOrigin(backend, parsed);
    } catch {
      return false;
    }
  });
}

function sameGatewayOrigin(left, right) {
  return left.protocol === right.protocol
    && normalizeGatewayHost(left.hostname) === normalizeGatewayHost(right.hostname)
    && (left.port || defaultPort(left.protocol)) === (right.port || defaultPort(right.protocol));
}

function normalizeGatewayHost(hostname) {
  const host = stringValue(hostname).trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::1") return "localhost";
  return host === "127.0.0.1" ? "localhost" : host;
}

function isUnsafeNetworkHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "localhost.localdomain") return true;
  if (host === "0.0.0.0") return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isUnsafeIpv4(host);
  if (ipVersion === 6) return isUnsafeIpv6(host);
  const mappedIpv4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4[1]);
  return false;
}

function normalizeHost(hostname) {
  return stringValue(hostname)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "")
    .replace(/\.+$/, "");
}

function isUnsafeIpv4(host) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isUnsafeIpv6(host) {
  if (host === "::" || host === "::1") return true;
  const mappedIpv4 = ipv4FromEmbeddedIpv6(host);
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4);
  const first = host.split(":").find(Boolean);
  const firstHextet = Number.parseInt(first || "0", 16);
  if (!Number.isFinite(firstHextet)) return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  return false;
}

function ipv4FromEmbeddedIpv6(host) {
  const hextets = expandIpv6Hextets(host);
  if (!hextets) return "";
  const firstFiveZero = hextets.slice(0, 5).every((part) => part === 0);
  const isMapped = firstFiveZero && hextets[5] === 0xffff;
  const isCompatible = firstFiveZero && hextets[5] === 0;
  if (!isMapped && !isCompatible) return "";
  const value = ((hextets[6] << 16) | hextets[7]) >>> 0;
  if (!value) return "";
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ].join(".");
}

function expandIpv6Hextets(host) {
  const value = stringValue(host).trim().toLowerCase();
  if (!value || value.includes(":::")) return null;
  const dotted = value.match(/(.+:)(\d+\.\d+\.\d+\.\d+)$/);
  let source = value;
  if (dotted) {
    const parts = dotted[2].split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    source = `${dotted[1]}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const hasCompress = source.includes("::");
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = hasCompress ? 8 - left.length - right.length : 0;
  if (missing < 0) return null;
  const parts = hasCompress ? [...left, ...Array(missing).fill("0"), ...right] : source.split(":");
  if (parts.length !== 8) return null;
  const hextets = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return Number.NaN;
    return Number.parseInt(part, 16);
  });
  return hextets.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff) ? null : hextets;
}

function defaultPort(protocol) {
  if (protocol === "http:") return "80";
  if (protocol === "https:") return "443";
  return "";
}

async function postPromptImageBackend(requestBody, backend) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutSeconds * 1000);
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (backend.apiKey) headers.Authorization = `Bearer ${backend.apiKey}`;
    const response = await fetch(`${backend.baseUrl}${backend.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      return {
        __backendError: true,
        statusCode: response.status,
        payload: json
      };
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function whitelistPromptBackendError(statusCode, payload) {
  const publicStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 502;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return finalImageError("PROMPT_IMAGE_BACKEND_UNAVAILABLE", "生图服务暂时不可用，请稍后重试。", publicStatusCode);
  }
  const sourceError = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
    ? payload.error
    : {};
  const code = sanitizePublicErrorCode(sourceError.code) || "PROMPT_IMAGE_BACKEND_UNAVAILABLE";
  const message = sanitizePublicErrorMessage(sourceError.message) || "生图服务暂时不可用，请稍后重试。";
  const error = {
    code,
    message
  };
  const backendCallSummary = sanitizeBackendCallSummary(sourceError.backend_call_summary || payload.backend_call_summary);
  if (backendCallSummary) error.backend_call_summary = backendCallSummary;
  return {
    statusCode: publicStatusCode,
    payload: {
      status: payload.status === "needs_clarification" ? "needs_clarification" : "failed",
      error,
      images: [],
      warnings: whitelistWarnings(payload.warnings)
    }
  };
}

function whitelistPromptBackendResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return finalImageError("PROMPT_IMAGE_BACKEND_INVALID_RESPONSE", "生成结果格式暂不支持。", 502);
  }
  if (payload.status && payload.status !== "succeeded") {
    const error = payload.error && typeof payload.error === "object" ? payload.error : {};
    return finalImageError(
      sanitizePublicErrorCode(error.code) || "PROMPT_IMAGE_BACKEND_INVALID_RESPONSE",
      sanitizePublicErrorMessage(error.message) || "生成结果格式暂不支持。",
      payload.status === "needs_clarification" ? 400 : 502
    );
  }
  const images = Array.isArray(payload && payload.images)
    ? payload.images.map(whitelistPromptBackendImage).filter(Boolean)
    : [];
  if (!images.length) {
    return finalImageError("PROMPT_IMAGE_BACKEND_INVALID_RESPONSE", "生成结果格式暂不支持。", 502);
  }
  return {
    statusCode: 200,
    payload: {
      status: "succeeded",
      images,
      warnings: whitelistWarnings(payload && payload.warnings)
    }
  };
}

function whitelistPromptBackendImage(image) {
  if (!image || typeof image !== "object" || Array.isArray(image)) return null;
  const url = stringValue(image.url).trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (!isAllowedBackendImageUrl(url)) return null;
  return { url };
}

function isAllowedBackendImageUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (isUnsafeNetworkHost(parsed.hostname)) {
    return isConfiguredBackendGeneratedImageUrl(parsed);
  }
  return true;
}

function isConfiguredBackendGeneratedImageUrl(parsed) {
  if (!/^\/api\/v1\/generated-images\/img_[a-f0-9]{32}$/i.test(parsed.pathname)) return false;
  const backendBase = stringValue(process.env.PROMPT_IMAGE_BACKEND_BASE_URL || getRuntimeConfig().promptImageBackendBaseUrl).trim();
  if (!backendBase) return false;
  let backend;
  try {
    backend = new URL(backendBase);
  } catch {
    return false;
  }
  return sameGatewayOrigin(parsed, backend);
}

function whitelistWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    if (typeof item === "string") return item.slice(0, 300);
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    const warning = {};
    const code = stringValue(item.code).trim();
    const message = stringValue(item.message).trim();
    if (code && !containsUnsafePublicText(code)) warning.code = code.slice(0, 80);
    if (message && !containsUnsafePublicText(message)) warning.message = message.slice(0, 300);
    return Object.keys(warning).length ? warning : "";
  }).filter(Boolean);
}

function containsUnsafePublicText(value) {
  return /authorization|bearer|api[_-]?key|token|secret|cookie|base64|b64_json|data:image|final_prompt|compiled_prompt|raw_provider|provider_payload|https?:|localhost|127\.0\.0\.1|\/api\/v1\/|\/private\/|\/var\/|\/users\//i.test(String(value || ""));
}

function sanitizePublicErrorCode(value) {
  const code = stringValue(value).trim();
  if (!code || code.length > 80 || !/^[A-Z0-9_]+$/.test(code) || containsUnsafePublicText(code)) return "";
  return code;
}

function sanitizePublicErrorMessage(value) {
  const message = stringValue(value).trim();
  if (!message || containsUnsafePublicText(message)) return "";
  return message.slice(0, 300);
}

function sanitizeBackendCallSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = {};
  const stage = safeEnum(value.stage, ["provider_submit", "provider_poll", "provider_normalize", "generated_store", "reference_fetch"]);
  if (stage) summary.stage = stage;
  const endpointKind = safeEnum(value.endpoint_kind, ["generations", "edits", "poll", "unknown"]);
  if (endpointKind) summary.endpoint_kind = endpointKind;
  const upstreamStatus = Number(value.upstream_status);
  if (Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599) {
    summary.upstream_status = upstreamStatus;
  }
  const providerErrorCode = sanitizeProviderErrorCode(value.provider_error_code);
  if (providerErrorCode) summary.provider_error_code = providerErrorCode;
  if (typeof value.retryable === "boolean") summary.retryable = value.retryable;
  const retryAfterMs = Number(value.retry_after_ms);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    summary.retry_after_ms = Math.min(3_600_000, Math.floor(retryAfterMs));
  }
  return Object.keys(summary).length ? summary : null;
}

function safeEnum(value, allowed) {
  const text = stringValue(value).trim();
  return allowed.includes(text) ? text : "";
}

function sanitizeProviderErrorCode(value) {
  const code = stringValue(value).trim();
  if (!code || code.length > 80 || !/^[A-Za-z0-9_.:-]+$/.test(code) || containsUnsafePublicText(code)) return "";
  return code;
}

function normalizePublicImageHostUrl(value) {
  let parsed;
  try {
    parsed = new URL(stringValue(value).trim());
  } catch {
    throw httpError(502, "image_host_unsafe_url", "图床返回了不安全的图片 URL。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(502, "image_host_unsafe_url", "图床返回了不安全的图片 URL。");
  }
  if (parsed.username || parsed.password || isUnsafeNetworkHost(parsed.hostname)) {
    throw httpError(502, "image_host_unsafe_url", "图床返回了不安全的图片 URL。");
  }
  parsed.hash = "";
  return parsed.toString();
}

function finalImageError(code, message, statusCode) {
  return {
    statusCode,
    payload: {
      status: "failed",
      error: {
        code,
        message
      },
      images: [],
      warnings: []
    }
  };
}

function legacyImageJobsDisabledPayload() {
  return {
    status: "failed",
    error: {
      code: "LEGACY_IMAGE_JOBS_DISABLED",
      message: "旧图片任务接口已停用，请使用 /api/v1/image-generations。"
    },
    images: [],
    warnings: []
  };
}

async function uploadReferenceFromRequest(request, ownerToken, host) {
  const { fields, files } = await readMultipartForm(request);
  const file = files.find((item) => item.fieldName === "image") || files[0];
  if (!file || !file.bytes || !file.bytes.length) {
    throw httpError(400, "missing_image", "请上传参考图片。");
  }
  if (!/^image\//i.test(file.type || "")) {
    throw httpError(400, "invalid_image", "参考图必须是图片文件。");
  }
  const config = getRuntimeConfig();
  const stored = storeReferenceImage(file, ownerToken, fields.name);
  if (config.imageHostMode === "imgbb") {
    try {
      return await uploadReferenceToImgbb(file, fields.name, config, stored.referenceId);
    } catch (error) {
      referenceImages.delete(stored.referenceId);
      throw error;
    }
  }
  const url = `http://${host}/api/reference-images/${encodeURIComponent(stored.referenceId)}`;
  return {
    referenceId: stored.referenceId,
    name: stored.name,
    type: stored.type,
    size: file.bytes.length,
    url,
    image_url: url
  };
}

function storeReferenceImage(file, ownerToken, rawName) {
  const referenceId = makeReferenceId();
  const item = {
    referenceId,
    ownerToken,
    name: safeFilename(rawName || file.filename || "reference"),
    type: file.type,
    bytes: file.bytes,
    createdAt: Date.now()
  };
  referenceImages.set(referenceId, item);
  return item;
}

function storedReferenceForRequest(image, ownerToken) {
  const referenceId = stringValue(image && image.referenceId).trim();
  if (!referenceId) return null;
  const stored = referenceImages.get(referenceId);
  if (!stored || stored.ownerToken !== ownerToken || !stored.bytes || !stored.bytes.length) return null;
  return stored;
}

async function uploadReferenceToImgbb(file, rawName, config, referenceId) {
  const key = stringValue(config.imageHostApiKey).trim();
  if (!key) {
    throw httpError(400, "missing_image_host_key", "图床 API Key 未配置。");
  }
  const endpoint = normalizeEndpoint(config.imageHostUploadUrl || "https://api.imgbb.com/1/upload");
  const url = new URL(endpoint);
  url.searchParams.set("key", key);
  const expiration = clampInt(config.imageHostExpirationSeconds, 0, 15552000, 0);
  if (expiration >= 60) url.searchParams.set("expiration", String(expiration));

  const form = new FormData();
  const blob = new Blob([file.bytes], { type: file.type || "image/png" });
  form.append("image", blob, safeFilename(file.filename || rawName || "reference.png"));
  const name = safeUploadName(rawName || file.filename || "");
  if (name) form.append("name", name);

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutSeconds * 1000);
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw httpError(504, "image_host_timeout", "图床上传超时，请检查图床配置或稍后重试。");
    }
    throw httpError(502, "image_host_unreachable", "图床连接失败，请稍后重试。");
  } finally {
    clearTimeout(timeout);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload.success === false) {
    const message = imageHostErrorMessage(payload) || `图床上传失败，HTTP ${response.status}。`;
    throw httpError(502, "image_host_failed", message);
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const imageUrl = [
    data.url,
    data.display_url,
    data.image && data.image.url,
    data.medium && data.medium.url,
    data.thumb && data.thumb.url
  ].find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
  if (!imageUrl) {
    throw httpError(502, "image_host_missing_url", "图床上传成功但没有返回图片 URL。");
  }
  const safeImageUrl = normalizePublicImageHostUrl(imageUrl);
  return {
    referenceId,
    host: "imgbb",
    name: safeFilename(file.filename || rawName || data.title || "reference"),
    type: file.type,
    size: file.bytes.length,
    url: safeImageUrl,
    image_url: safeImageUrl
  };
}

function serveReferenceImage(response, referenceId) {
  const item = referenceImages.get(referenceId);
  if (!item) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    return response.end("reference image not found");
  }
  response.writeHead(200, {
    "Content-Type": item.type || "image/png",
    "Content-Length": item.bytes.length,
    "Cache-Control": "no-store"
  });
  response.end(item.bytes);
}

function defaultRuntimeConfig() {
  return {
    promptImageBackendBaseUrl: optionalEndpoint(process.env.PROMPT_IMAGE_BACKEND_BASE_URL),
    promptImageBackendGenerationPath: normalizePath(process.env.PROMPT_IMAGE_BACKEND_GENERATION_PATH || PROMPT_IMAGE_BACKEND_DEFAULT_PATH),
    promptImageBackendApiKey: stringValue(process.env.PROMPT_IMAGE_BACKEND_API_KEY).trim(),
    promptImageBackendTimeoutSeconds: clampInt(
      process.env.PROMPT_IMAGE_BACKEND_TIMEOUT_SECONDS,
      1,
      900,
      PROMPT_IMAGE_BACKEND_DEFAULT_TIMEOUT_SECONDS
    ),
    imageHostMode: (process.env.IMAGE_HOST_MODE || "imgbb").toLowerCase() === "local" ? "local" : "imgbb",
    imageHostUploadUrl: normalizeEndpoint(process.env.IMGBB_UPLOAD_URL || "https://api.imgbb.com/1/upload"),
    imageHostApiKey: stringValue(process.env.IMGBB_API_KEY || process.env.IMAGE_HOST_API_KEY).trim(),
    imageHostExpirationSeconds: clampInt(process.env.IMGBB_EXPIRATION_SECONDS, 0, 15552000, 0),
    requestTimeoutSeconds: clampInt(process.env.REQUEST_TIMEOUT_SECONDS, 10, 900, 180)
  };
}

async function loadRuntimeConfig() {
  const defaults = defaultRuntimeConfig();
  if (!existsSync(CONFIG_FILE)) return defaults;
  try {
    const raw = parseRuntimeConfigText(await readFile(CONFIG_FILE, "utf8"));
    return sanitizeRuntimeConfig(raw, defaults);
  } catch (error) {
    console.warn("[gateway] failed to load runtime config, using env/defaults", {
      configFile: CONFIG_FILE,
      message: error.message
    });
    return defaults;
  }
}

function parseRuntimeConfigText(text) {
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

async function saveRuntimeConfig(config) {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function sanitizeRuntimeConfig(value, defaults = defaultRuntimeConfig()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    promptImageBackendBaseUrl: optionalEndpoint(source.promptImageBackendBaseUrl || defaults.promptImageBackendBaseUrl),
    promptImageBackendGenerationPath: normalizePath(source.promptImageBackendGenerationPath || defaults.promptImageBackendGenerationPath || PROMPT_IMAGE_BACKEND_DEFAULT_PATH),
    promptImageBackendApiKey: stringValue(source.promptImageBackendApiKey).trim() || defaults.promptImageBackendApiKey || "",
    promptImageBackendTimeoutSeconds: clampInt(
      source.promptImageBackendTimeoutSeconds,
      1,
      900,
      defaults.promptImageBackendTimeoutSeconds || PROMPT_IMAGE_BACKEND_DEFAULT_TIMEOUT_SECONDS
    ),
    imageHostMode: source.imageHostMode === "local" ? "local" : "imgbb",
    imageHostUploadUrl: normalizeEndpoint(source.imageHostUploadUrl || defaults.imageHostUploadUrl || "https://api.imgbb.com/1/upload"),
    imageHostApiKey: stringValue(source.imageHostApiKey).trim() || defaults.imageHostApiKey || "",
    imageHostExpirationSeconds: clampInt(source.imageHostExpirationSeconds, 0, 15552000, defaults.imageHostExpirationSeconds || 0),
    requestTimeoutSeconds: clampInt(source.requestTimeoutSeconds, 10, 900, defaults.requestTimeoutSeconds || 180)
  };
}

function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    throw httpError(400, "invalid_base_url", "Base URL 必须是 http 或 https 地址。");
  }
  return endpoint.replace(/\/+$/, "");
}

function optionalEndpoint(value) {
  const endpoint = String(value || "").trim();
  return endpoint ? normalizeEndpoint(endpoint) : "";
}

function normalizePath(value) {
  const path = String(value || "").trim() || PROMPT_IMAGE_BACKEND_DEFAULT_PATH;
  return path.startsWith("/") ? path : `/${path}`;
}

function getRuntimeConfig() {
  return runtimeConfig || defaultRuntimeConfig();
}

function hasPromptImageBackendConfig(config = getRuntimeConfig()) {
  return Boolean(stringValue(config.promptImageBackendBaseUrl).trim() || stringValue(process.env.PROMPT_IMAGE_BACKEND_BASE_URL).trim());
}

function configResponse(request) {
  const config = getRuntimeConfig();
  const host = request.headers.host || `${HOST}:${PORT}`;
  return {
    config: {
      mode: "live",
      promptImageBackendBaseUrl: config.promptImageBackendBaseUrl,
      promptImageBackendGenerationPath: config.promptImageBackendGenerationPath,
      promptImageBackendApiKeyConfigured: Boolean(config.promptImageBackendApiKey || process.env.PROMPT_IMAGE_BACKEND_API_KEY),
      promptImageBackendTimeoutSeconds: config.promptImageBackendTimeoutSeconds,
      promptImageBackendConfigured: hasPromptImageBackendConfig(config),
      imageHostMode: config.imageHostMode,
      imageHostUploadUrl: config.imageHostUploadUrl,
      imageHostApiKeyConfigured: Boolean(config.imageHostApiKey),
      imageHostExpirationSeconds: config.imageHostExpirationSeconds,
      requestTimeoutSeconds: config.requestTimeoutSeconds
    },
    paths: requestPaths(host, config),
    configFile: CONFIG_FILE
  };
}

function requestPaths(host, config = getRuntimeConfig()) {
  return {
    createJob: `POST http://${host}/api/v1/image-generations`,
    config: `GET/POST http://${host}/api/config`,
    uploadReference: `POST http://${host}/api/reference-images`,
    imageHost: config.imageHostMode === "local" ? `GET http://${host}/api/reference-images/<referenceId>` : config.imageHostUploadUrl,
    promptImageBackend: config.promptImageBackendBaseUrl
      ? `POST ${config.promptImageBackendBaseUrl}${config.promptImageBackendGenerationPath}`
      : "",
    configFile: CONFIG_FILE
  };
}

async function readFinalImageJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      return { error: { message: "请求体过大。" } };
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return { value: text ? JSON.parse(text) : {} };
  } catch {
    return { error: { message: "请求体不是合法 JSON。" } };
  }
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw httpError(413, "body_too_large", "请求体过大。");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw httpError(400, "invalid_json", "请求体不是合法 JSON。");
  }
}

async function readMultipartForm(request) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw httpError(400, "invalid_multipart", "请求体不是合法 multipart/form-data。");
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw httpError(413, "body_too_large", "请求体过大。");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const fields = {};
  const files = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(boundary, cursor);
    if (start === -1) break;
    cursor = start + boundary.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const rawHeaders = body.slice(cursor, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;
    let part = body.slice(headerEnd + 4, nextBoundary);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.slice(0, -2);
    }
    const disposition = rawHeaders.match(/content-disposition:\s*form-data;([^\r\n]+)/i);
    const name = disposition && disposition[1].match(/name="([^"]+)"/i);
    const filename = disposition && disposition[1].match(/filename="([^"]*)"/i);
    const type = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
    const fieldName = name ? name[1] : "";
    if (filename) {
      files.push({
        fieldName,
        filename: safeFilename(filename[1] || "upload"),
        type: type ? type[1].trim().toLowerCase() : "application/octet-stream",
        bytes: part
      });
    } else if (fieldName) {
      fields[fieldName] = part.toString("utf8");
    }
    cursor = nextBoundary;
  }
  return { fields, files };
}

function ensureOwner(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const existing = cookies[OWNER_COOKIE];
  if (existing && /^[A-Za-z0-9_-]{32,128}$/.test(existing)) {
    return { ownerToken: existing, isNewOwner: false };
  }
  return {
    ownerToken: randomBytes(32).toString("base64url"),
    isNewOwner: true
  };
}

function setOwnerCookie(response, ownerToken) {
  response.setHeader("Set-Cookie", `${OWNER_COOKIE}=${ownerToken}; Path=/; SameSite=Lax; HttpOnly`);
}

function parseCookies(header) {
  const cookies = {};
  header.split(";").forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return;
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
  });
  return cookies;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function httpError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, details);
  return error;
}

function makeReferenceId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = typeof randomUUID === "function" ? randomUUID() : randomBytes(32).toString("base64url");
    if (!referenceImages.has(id)) return id;
  }
  return randomBytes(32).toString("base64url");
}

function cleanExpiredRecords() {
  const now = Date.now();
  for (const [referenceId, item] of referenceImages.entries()) {
    if (now - item.createdAt > REFERENCE_TTL_MS) {
      referenceImages.delete(referenceId);
    }
  }
}

function walk(value, visitor, depth = 0) {
  if (depth > 7 || value == null) return;
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor, depth + 1));
  } else if (typeof value === "object") {
    Object.values(value).forEach((item) => walk(item, visitor, depth + 1));
  }
}

function errorToMessage(error) {
  if (!error) return "未知错误。";
  if (error.message) return error.message;
  return String(error);
}

function imageHostErrorMessage(json) {
  const candidates = [];
  collectErrorText(json && json.error, candidates);
  collectErrorText(json && json.status_txt, candidates);
  collectErrorText(json && json.message, candidates);
  return sanitizeErrorText(candidates.find(Boolean));
}

function collectErrorText(value, candidates, depth = 0) {
  if (value == null || depth > 3) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    candidates.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectErrorText(item, candidates, depth + 1));
    return;
  }
  if (typeof value === "object") {
    ["message", "detail", "code", "type", "param", "rawText"].forEach((key) => collectErrorText(value[key], candidates, depth + 1));
    if (!candidates.length) {
      try {
        candidates.push(JSON.stringify(value));
      } catch {
        candidates.push(String(value));
      }
    }
  }
}

function sanitizeErrorText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function parseBytes(value) {
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/i);
  if (!match) return 50 * 1024 * 1024;
  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  const multiplier = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return Math.floor(amount * multiplier);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function safeFilename(name) {
  return String(name || "image.png").replace(/[\\/:*?"<>|]+/g, "-");
}

function safeUploadName(name) {
  const base = safeFilename(name || "")
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "";
}

async function serveConfigPage(request, response) {
  const html = configPageHtml(request.headers.host || `${HOST}:${PORT}`);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

function configPageHtml(host) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>生图网关配置</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f2efe8;
      --card: #fffdfa;
      --text: #17202b;
      --muted: #607086;
      --line: #d8ddd7;
      --line-strong: #c8d1cd;
      --primary: #157a91;
      --primary-strong: #0f6578;
      --ok: #2f7d42;
      --bad: #ad3b3b;
      --input: #ffffff;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at top left, rgba(21, 122, 145, .08), transparent 28%), var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .wrap {
      width: min(1040px, calc(100vw - 48px));
      margin: 16px auto 40px;
      background: var(--card);
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      box-shadow: 0 28px 70px rgba(55, 48, 35, .08);
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding: 22px 30px 20px;
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 32px;
      line-height: 1.12;
      font-weight: 900;
    }
    .sub {
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
    }
    .status {
      min-width: 96px;
      text-align: right;
      color: #40566a;
      font-size: 15px;
      line-height: 1.55;
      font-weight: 700;
    }
    main {
      padding: 22px 30px 24px;
    }
    label {
      display: grid;
      gap: 8px;
      margin-bottom: 18px;
      font-size: 14px;
      font-weight: 900;
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: var(--input);
      color: var(--text);
      font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      padding: 11px 14px;
      outline: none;
    }
    textarea { min-height: 132px; resize: vertical; }
    input:focus, textarea:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(21, 122, 145, .14);
    }
    .hint {
      margin-top: -8px;
      margin-bottom: 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
      font-weight: 700;
    }
    .panel {
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      padding: 15px 18px;
      margin-bottom: 20px;
      background: #fffefb;
    }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 18px;
      line-height: 1.2;
    }
    .path-grid {
      display: grid;
      grid-template-columns: 150px 1fr;
      gap: 10px 22px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 800;
    }
    .path-grid code {
      color: var(--text);
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      word-break: break-all;
    }
    .tabs {
      width: 430px;
      max-width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      overflow: hidden;
      margin: 0 0 18px;
      background: #ffffff;
    }
    .tabs button {
      border: 0;
      min-height: 38px;
      background: transparent;
      color: var(--muted);
      font-weight: 900;
      cursor: pointer;
    }
    .tabs button.active {
      background: var(--primary);
      color: #ffffff;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
    }
    button.primary, button.secondary {
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      min-height: 42px;
      padding: 0 20px;
      font-size: 14px;
      font-weight: 900;
      cursor: pointer;
    }
    button.primary {
      border-color: var(--primary);
      background: var(--primary);
      color: #ffffff;
    }
    button.primary:hover { background: var(--primary-strong); }
    button.secondary {
      background: #ffffff;
      color: var(--text);
    }
    #feedback {
      margin-left: auto;
      color: var(--muted);
      font-size: 14px;
      font-weight: 800;
    }
    #feedback.good { color: var(--ok); }
    #feedback.bad { color: var(--bad); }
    @media (max-width: 760px) {
      .wrap { width: calc(100vw - 24px); margin-top: 12px; }
      header, main { padding-left: 18px; padding-right: 18px; }
      header { flex-direction: column; }
      .status { text-align: left; }
      .grid-2, .path-grid { grid-template-columns: 1fr; }
      .actions { flex-wrap: wrap; }
      #feedback { width: 100%; margin-left: 0; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>生图网关配置</h1>
        <div class="sub">局域网可访问 · 无密码 · 保存后立即生效</div>
      </div>
      <div class="status"><div id="modeText">live</div><div id="backendStatus">backend missing</div></div>
    </header>
    <main>
      <section class="panel">
        <h2>最终生图后端</h2>
        <label>
          后端 Base URL
          <input id="promptImageBackendBaseUrl" spellcheck="false" autocomplete="off">
        </label>
        <div class="grid-2">
          <label>
            生成接口路径
            <input id="promptImageBackendGenerationPath" spellcheck="false" autocomplete="off">
          </label>
          <label>
            请求超时秒数
            <input id="promptImageBackendTimeoutSeconds" type="number" min="1" max="900" step="10">
          </label>
        </div>
        <label>
          后端 API Key
          <input id="promptImageBackendApiKey" spellcheck="false" autocomplete="off">
        </label>
        <p class="hint">网关只转发到最终生图后端；供应商模型、generations/edits 分流与参考图绑定由后端合同处理。</p>
      </section>

      <section class="panel">
        <h2>请求路径</h2>
        <div class="path-grid" id="pathGrid"></div>
      </section>

      <section class="panel">
        <h2>参考图图床</h2>
        <div class="grid-2">
          <label>
            图床模式
            <select id="imageHostMode">
              <option value="imgbb">imgbb</option>
              <option value="local">local</option>
            </select>
          </label>
          <label>
            过期秒数
            <input id="imageHostExpirationSeconds" type="number" min="0" step="60">
          </label>
        </div>
        <label>
          imgbb 上传端点
          <input id="imageHostUploadUrl" spellcheck="false" autocomplete="off">
        </label>
        <label>
          imgbb API Key
          <input id="imageHostApiKey" spellcheck="false" autocomplete="off">
        </label>
        <p class="hint">local 仅适合同机调试；需要公网访问参考图时使用 imgbb。</p>
      </section>

      <div class="actions">
        <button class="primary" id="saveBtn" type="button">保存</button>
        <button class="secondary" id="reloadBtn" type="button">重新载入</button>
        <span id="feedback"></span>
      </div>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);

    $("saveBtn").addEventListener("click", saveConfig);
    $("reloadBtn").addEventListener("click", reloadConfig);

    loadConfig();

    async function loadConfig() {
      setFeedback("正在载入配置。");
      const response = await fetch("/api/config", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error && payload.error.message || "载入失败");
      renderConfig(payload);
      setFeedback("");
    }

    async function reloadConfig() {
      setFeedback("正在重新载入。");
      const response = await fetch("/api/reload-config", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        setFeedback(payload.error && payload.error.message || "重新载入失败。", "bad");
        return;
      }
      renderConfig(payload);
      setFeedback(payload.message || "已重新载入。", "good");
    }

    async function saveConfig() {
      setFeedback("正在保存。");
      const payload = {
        promptImageBackendBaseUrl: $("promptImageBackendBaseUrl").value.trim(),
        promptImageBackendGenerationPath: $("promptImageBackendGenerationPath").value.trim(),
        promptImageBackendApiKey: $("promptImageBackendApiKey").value.trim(),
        promptImageBackendTimeoutSeconds: Number($("promptImageBackendTimeoutSeconds").value || 120),
        imageHostMode: $("imageHostMode").value,
        imageHostUploadUrl: $("imageHostUploadUrl").value.trim(),
        imageHostApiKey: $("imageHostApiKey").value.trim(),
        imageHostExpirationSeconds: Number($("imageHostExpirationSeconds").value || 0),
        requestTimeoutSeconds: Number($("promptImageBackendTimeoutSeconds").value || 120)
      };
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        setFeedback(result.error && result.error.message || "保存失败。", "bad");
        return;
      }
      renderConfig(result);
      setFeedback(result.message || "已保存并生效。", "good");
    }

    function renderConfig(payload) {
      const config = payload.config || {};
      $("promptImageBackendBaseUrl").value = config.promptImageBackendBaseUrl || "";
      $("promptImageBackendGenerationPath").value = config.promptImageBackendGenerationPath || "/api/v1/image-generations";
      $("promptImageBackendApiKey").value = "";
      $("promptImageBackendApiKey").placeholder = config.promptImageBackendApiKeyConfigured ? "已配置，留空将清除或覆盖" : "";
      $("promptImageBackendTimeoutSeconds").value = Number.isFinite(Number(config.promptImageBackendTimeoutSeconds)) ? Number(config.promptImageBackendTimeoutSeconds) : 120;
      $("imageHostMode").value = config.imageHostMode || "imgbb";
      $("imageHostUploadUrl").value = config.imageHostUploadUrl || "https://api.imgbb.com/1/upload";
      $("imageHostApiKey").value = "";
      $("imageHostApiKey").placeholder = config.imageHostApiKeyConfigured ? "已配置，留空将清除或覆盖" : "";
      $("imageHostExpirationSeconds").value = Number.isFinite(Number(config.imageHostExpirationSeconds)) ? Number(config.imageHostExpirationSeconds) : 0;
      $("modeText").textContent = config.mode || "live";
      $("backendStatus").textContent = config.promptImageBackendConfigured ? "backend configured" : "backend missing";
      const paths = payload.paths || {};
      const rows = [
        ["创建任务", paths.createJob],
        ["配置接口", paths.config],
        ["参考图上传", paths.uploadReference],
        ["图床", paths.imageHost],
        ["最终生图后端", paths.promptImageBackend],
        ["配置文件", payload.configFile]
      ];
      $("pathGrid").innerHTML = rows.map(([label, value]) => "<div>" + escapeHtml(label) + "</div><code>" + escapeHtml(value || "") + "</code>").join("");
    }

    function setFeedback(message, kind = "") {
      $("feedback").textContent = message || "";
      $("feedback").className = kind;
    }

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }
  </script>
</body>
</html>`;
}
