# Final Integrator Report: Live Provider Browser Path Repair

Task: `T1-live-provider-browser-path-repair`
Reviewed at: `2026-06-16T08:02:00Z`
Branch: `main01`

## Status

`PASS_UPSTREAM_502_REPAIRED_BROWSER_PASS`

The live browser path now completes end to end for both text-to-image and image-to-image. The UI submits through `/api/v1/image-generations`, the backend reaches the provider submit path, real provider output is normalized into the Generated Image Store, and the public `images[].url` resources return GET 200 with `Cache-Control: no-store`.

The earlier upstream 502 was not a fake-image or store-validation issue. The provider showed consumption, while local fetch saw the submit response terminate or become unreachable before a complete body was delivered. The repair keeps the provider contract strict and adds a safe recovery path only when the already-buffered response body is a complete JSON payload or a complete PNG/JPEG/WEBP image.

## Root Cause

- Provider submit reached the live upstream; Memefast usage evidence showed consumption for `gpt-image-2`.
- The failing layer was response transport around provider submit, before normalizer/store could run.
- UI/backend error handling flattened provider submit failures into a generic unavailable message.
- Common provider image shapes were not all covered, so a valid nonstandard JSON image field could have been rejected as empty.

## Fixes

- Preserved safe `backend_call_summary` through backend and UI error formatting.
- Kept text generation fixed to `gpt-image-2` and `/v1/images/generations`.
- Removed unsupported text-generation knobs from the provider body and verified only `model`, `prompt`, `n`, `size`, `quality`, and `format` are sent when applicable.
- Added JSON submit headers for provider generations and disabled response compression/connection reuse for the submit request.
- Added complete-payload stream recovery for provider JSON/image responses when the connection terminates after the full body is already buffered.
- Expanded provider result normalization for top-level, nested, chat-style URL, direct binary, and encoded PNG/JPEG/WEBP results.
- Kept Generated Image Store strict: real PNG/JPEG/WEBP pass; fake image bytes are rejected.
- Prevented fake success, placeholder URLs, public encoded payloads, and provider internals exposure.

## Subagents

- Upstream Investigator: `PASS_EVIDENCE`, Apifox contract checked and Memefast consumption evidence incorporated.
- Provider Integration Reviewer: `PASS_CONTRACT`, generations contract and transport repair reviewed.
- Backend Reviewer: `PASS_STATIC`, backend failure classification and Generated Store path reviewed.
- Gateway Reviewer: `PASS_STATIC`, UI fresh submit and error-code propagation reviewed.
- Browser QA: `PASS_BROWSER`, text-to-image and image-to-image both passed in Codex Browser.
- Security Reviewer: `PASS_SECURITY`, no sensitive provider/config material staged.
- Test Reviewer: `PASS_TESTED`, targeted and full tests passed.
- Final Integrator: `PASS_UPSTREAM_502_REPAIRED_BROWSER_PASS`.

## Browser

- Text-to-image: `PASS_BROWSER`; live trace succeeded at `2026-06-16T07:46:01Z`, `image_count=1`.
- Text public image: `PASS_BROWSER`; GET 200, `Cache-Control: no-store`, `Content-Type: image/png`.
- Image-to-image: `PASS_BROWSER`; user uploaded a real local image, live trace succeeded at `2026-06-16T07:55:31Z`, `image_count=1`.
- Image-to-image public image: `PASS_BROWSER`; GET 200, `Cache-Control: no-store`, `Content-Type: image/png`.

## Verification

- `node --test tests/unit/image-api.test.js tests/unit/ai-tu-prompt-optimizer.test.js`: `PASS_TESTED`, 118/118.
- `npm run check`: `PASS_STATIC`.
- `npm test`: `PASS_TESTED`, 130/130.
- Provider config integration: `PASS_CONTRACT`, `REAL_PROVIDER_CONFIG_PRESENT`.
- Final evidence scan: `PASS_EVIDENCE`, `FINAL_V1_4_EVIDENCE_SCAN_PASS`.
- `git diff --check`: `PASS_STATIC`.
- Review gate: `PASS_EVIDENCE`, blocking count `0`.
- `codegraph sync . && codegraph status --json`: `PASS_STATIC`, pending changes `0`.

## Security

Only sanitized status, stage, endpoint kind, HTTP status, provider error code, retryability, image count, MIME type, and cache headers were recorded. No local secret material, provider internals, prompt text, encoded image body, or browser internals were written.

## Decision

`allowed_to_continue_dev=yes`
`allowed_to_merge_main=no`
