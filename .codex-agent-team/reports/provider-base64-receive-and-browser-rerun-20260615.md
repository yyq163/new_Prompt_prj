# Provider Base64 Receive And Browser Rerun - 2026-06-15

## FINAL_STATUS

SUPERSEDED: this older rerun observed image-to-image provider failure. The
latest `main01` browser rerun passed image edit; this file remains historical
context only and does not authorize pushing `main`.

## Root Cause Check

- Local parser gap was real: upstream-compatible JSON shapes using `data[].image` or `data[].result` as naked base64 were previously not accepted unless they used a data URL.
- Fixed behavior: `provider encoded image field`, `base64`, `image_base64`, `data_url`, `data[].image` naked base64, `data[].result` naked base64, binary object fields, direct binary HTTP image responses all normalize into Generated Image Store service URLs.
- Direct provider shape probes using the real runtime config did not show a base64 response being dropped. One edit probe observed a delayed upstream JSON error shape, and one direct text probe observed a JSON error shape. These probes did not expose raw provider body, prompt, key, or reference URL.

## Code Changes Covered By Review

- `src/providers/provider-result-normalizer.js`: accepts additional base64 and binary image result shapes without leaking raw bytes/base64.
- `src/providers/ai-tu-provider-adapter.js`: separates configured submit endpoints from provider-returned poll URLs; adds `redirect: "manual"` for provider fetches.
- `ai-tu/ai-image-generator.html`: formats structured final-image errors through `normalizeErrorMessage/jobErrorMessage` so UI does not display `[object Object]`.
- `src/core/errors.js`: preserves `PUBLIC_BASE_URL_REQUIRED` in the v3.6 public error envelope instead of mapping it to provider invalid response.

## Review

- Security Reviewer rerun: PASS, no P0/P1/P2. Confirmed Authorization is only sent to configured submit endpoints or allowed same-origin `/v1/` poll URLs, dangerous poll URLs are rejected before fetch, redirects are manual, and public responses do not leak raw URL/key/Authorization/base64.
- Code Reviewer rerun: PASS, no P0/P1/P2. Confirmed base64/binary receive fix, endpoint/poll separation, UI error formatting, and `PUBLIC_BASE_URL_REQUIRED` mapping.

## Automated Verification

- `npm run check`: PASS.
- `npm test`: PASS, 101 tests.
- `AI_TU_RUNTIME_CONFIG_FILE=真实配置.json node tests/integration/provider-config.test.js`: PASS, `REAL_PROVIDER_CONFIG_PRESENT`.
- `node tests/integration/final-v1-4-evidence.test.js`: PASS, `FINAL_V1_4_EVIDENCE_SCAN_PASS`.
- Targeted review tests run by subagents: PASS.

## Real Browser Verification

Text-to-image:

- Browser session: `real-config-401-check-20260615`.
- `POST /api/v1/image-generations`: HTTP 200 after about 106 seconds.
- Public response: `status=succeeded`, `images.length=1`, no sensitive leakage detected in public body.
- Image preview: visible in browser.
- Generated image GET: HTTP 200, `Content-Type: image/png`, `Cache-Control: no-store`, `Content-Length: 1484413`.
- Screenshot: retained as sanitized PNG and tracked on `main01`.

Image-to-image:

- Browser session: `real-config-image-small-20260615`.
- Reference upload: `POST /api/reference-images` HTTP 200 with a small local test image from `/Volumes/App_Dev/test-image`.
- `POST /api/v1/image-generations`: HTTP 502 after about 156 seconds.
- Public response: `status=failed`, `error.code=PROMPT_IMAGE_BACKEND_UNAVAILABLE`, `images.length=0`, no sensitive leakage detected.
- UI: displays clear Chinese failure message, not `[object Object]`.
- Screenshot: retained as sanitized PNG and tracked on `main01`.

## Contract Status

- No mock success was used.
- `gpt-image-2` fixed model rule remains covered by provider tests.
- Final API endpoints remain unchanged.
- Public responses continue to exclude raw provider payload, base64, Authorization, provider key, compiled/final prompt internals, enhancement, and storyboard internals.

## Blocker

This older blocker has been superseded by the latest `main01` browser rerun,
where image edit returned public success and generated-image GET no-store.
