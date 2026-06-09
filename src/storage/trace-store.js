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
    image_count: Number(record.image_count || 0),
    status: record.status,
    error_code: record.error_code || "",
    warning_count: Number(record.warning_count || 0)
  };
  await mkdir(dirname(TRACE_FILE), { recursive: true });
  await appendFile(TRACE_FILE, `${JSON.stringify(safeRecord)}\n`, "utf8");
}
