import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256Short } from "../core/runtime.js";

const TRACE_FILE = resolve(".codex-agent-team/state/trace-store.jsonl");

export async function appendTrace(record) {
  const safeRecord = {
    ts: new Date().toISOString(),
    endpoint: record.endpoint || "",
    method: record.method || "",
    trace_id: record.trace_id,
    request_id: record.request_id,
    generation_id: record.generation_id || "",
    task_type: record.task_type,
    generation_mode: record.generation_mode,
    prompt_sha256_16: sha256Short(record.prompt || ""),
    reference_count: Number(record.reference_count || 0),
    callback_present: Boolean(record.callback_present),
    image_count: Number(record.image_count || 0),
    status: record.status,
    error_code: record.error_code || "",
    warning_count: Number(record.warning_count || 0),
    backend_call_summary: sanitizeBackendCallSummary(record.backend_call_summary)
  };
  await mkdir(dirname(TRACE_FILE), { recursive: true });
  await appendFile(TRACE_FILE, `${JSON.stringify(safeRecord)}\n`, "utf8");
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
  const providerErrorCode = safeProviderErrorCode(value.provider_error_code);
  if (providerErrorCode) summary.provider_error_code = providerErrorCode;
  if (typeof value.retryable === "boolean") summary.retryable = value.retryable;
  const retryAfterMs = Number(value.retry_after_ms);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    summary.retry_after_ms = Math.min(3_600_000, Math.floor(retryAfterMs));
  }
  return Object.keys(summary).length ? summary : null;
}

function safeEnum(value, allowed) {
  const text = typeof value === "string" ? value.trim() : "";
  return allowed.includes(text) ? text : "";
}

function safeProviderErrorCode(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 80) return "";
  if (!/^[a-zA-Z0-9_.:-]+$/.test(text)) return "";
  if (/https?:|bearer|token|secret|key|base64|data:image/i.test(text)) return "";
  return text;
}
