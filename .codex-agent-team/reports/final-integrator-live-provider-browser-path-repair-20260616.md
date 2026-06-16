# Final Integrator Report: Live Provider Browser Path Repair

Task: `T1-live-provider-browser-path-repair`
Reviewed at: `2026-06-16T06:39:50Z`
Branch: `main01`

## Status

`FAIL_LIVE_PROVIDER_PATH_BLOCKED`

The local code path was repaired and hardened, but the required live browser success condition was not met. Real Browser text-to-image submission reached the live provider path and failed with public `PROMPT_IMAGE_BACKEND_UNAVAILABLE`; a follow-up sanitized API diagnostic returned `backend_call_summary.stage=provider_submit`, `endpoint_kind=generations`, `upstream_status=502`, `provider_error_code=upstream_terminated`, `retryable=true`. No `images[].url` was returned, so no generated image GET 200 was possible.

Image-to-image browser upload remains `UNVERIFIED`: Codex Browser can operate the page but cannot set local file inputs; Computer Use could read Safari state but refused follow-up click actions in this session. The edits route remains covered by unit tests and adapter contract tests, but that is not a browser PASS.

## Root Cause

- UI fresh submit path uses `/api/v1/image-generations`, not legacy `/api/image-jobs`.
- The backend route was reached.
- The provider submit path was reached.
- Failure occurred before normalizer or Generated Image Store: provider connection terminated during generations submit.
- Previous public error mapping flattened all provider failures into “生图服务暂时不可用，请稍后重试。” without a safe backend-call summary.

## Fixes

- Added safe `backend_call_summary` propagation for provider submit, poll timeout, and provider result normalization failures.
- Added trace-store sanitization for the same summary fields.
- Added submit endpoint self-recursion guard for generations and edits URLs.
- Prevented temporary `pending_*` UI jobs from being persisted into legacy `/api/image-jobs` restore polling.
- Kept success contract as public `images[].url` only.

## Subagents

- Browser QA: `FAIL` for text-to-image browser; image-to-image `UNVERIFIED`.
- Gateway Reviewer: `PASS_STATIC`; UI fresh submit uses `/api/v1/image-generations`, old `/api/image-jobs` only remains historical restore/compat.
- Backend Reviewer: `PASS_STATIC`; route receives requests and maps public contract.
- Provider Integration Reviewer: `FAIL`; live provider submit returned upstream terminated.
- Generated Store Reviewer: `PASS_TESTED`; strict validation remains covered and was not the live failure layer.
- Security Reviewer: `PASS_SECURITY`.
- Test Reviewer: `PASS_TESTED`.
- Final Integrator: `FAIL_LIVE_PROVIDER_PATH_BLOCKED`.

## Verification

- `npm run check`: `PASS_STATIC`
- `npm test`: `PASS_TESTED`
- `AI_TU_RUNTIME_CONFIG_FILE=真实配置.json node tests/integration/provider-config.test.js`: `PASS_CONTRACT`
- `node tests/integration/final-v1-4-evidence.test.js`: `PASS_EVIDENCE`
- `git diff --check`: `PASS_STATIC`
- `codegraph sync . && codegraph status --json`: `PASS_STATIC`, pending changes `0`
- Browser text-to-image: `FAIL`, provider submit upstream terminated, no image URL.
- Browser image-to-image: `UNVERIFIED`, local file upload could not be completed through available browser-control surface.

## Security

No runtime config, key, token, raw provider response, raw prompt, raw base64, `data:image`, HAR, or network trace was written to the report. The added trace summary records only `stage`, `endpoint_kind`, `upstream_status`, `provider_error_code`, `retryable`, and `retry_after_ms`.

## Decision

`allowed_to_continue_dev=yes`
`allowed_to_merge_main=no`
