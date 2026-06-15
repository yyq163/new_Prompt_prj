# Provider Edits Debug Report - 2026-06-15

## FINAL_STATUS

IMAGE_EDIT_BLOCKED

base64/binary normalizer 修复和自动化回归已通过；真实浏览器文生图 PASS；真实浏览器图生图上传 PASS，但 `/v1/images/edits` 上游链路仍返回公开 502 `PROMPT_IMAGE_BACKEND_UNAVAILABLE`。未使用 mock success，未 push main。

## Base64 Normalizer

- `data[0].image`: supported。
- `data[0].result`: supported。
- `b64_json/base64/image_base64/data_url`: supported。
- data URL: supported。
- binary object / direct Buffer / ArrayBuffer / typed array: supported。
- direct HTTP image response: wrapped into normalizer and stored。
- Generated Image Store: all encoded/binary accepted images become service image URLs.
- public base64 leaked: false。
- invalid base64 / wrong magic bytes: rejected as provider invalid response, public response does not leak raw payload。

## Edits Investigation

- endpoint: `/v1/images/edits`。
- model: `gpt-image-2`。
- multipart fields: `model`, `prompt`, repeated `image[]` file parts。
- intentionally not sent: `n`, `size`, `quality`, `response_format`, `background`, `mask`。
- filename: sanitized URL basename with fallback `reference.png`。
- MIME: fetched reference bytes are magic-byte checked and Blob type uses detected MIME.
- reference image source: `/Volumes/App_Dev/test-image` auto-selected smallest JPEG.
- reference image mime: `image/jpeg`。
- reference upload: `/api/reference-images` HTTP 200, generated-image-store host.
- upstream consumption checked: no direct Apifox/Memefast account console available in this runtime; browser and provider-config evidence confirm request reached provider path and returned backend-unavailable public failure. No raw request/response/key/prompt/reference URL was recorded.
- upstream result summary: redacted; public failure code `PROMPT_IMAGE_BACKEND_UNAVAILABLE`, image edit elapsed 10697 ms.

## Subagent Reports

- Edits Protocol Reviewer: PASS, suggested image[] and helper-level empty image guard; both covered.
- Provider Config Reviewer: PASS, suggested deriving endpoint from references instead of trusting generation_mode; implemented and covered.
- Normalizer Reviewer: PASS, suggested explicit top-level encoded and typed-array tests; implemented and covered.
- Security Reviewer: initial FAIL due old trace/report artifacts and scan blind spots; rereview PASS after artifact redaction and expanded evidence scan.
- Browser QA: BLOCKED, text image PASS and image edit failed honestly with upstream/backend unavailable public error.
- Test Reviewer: PASS, suggested public invalid encoded payload no-leak tests; implemented.
- Final Integrator: pending final gate after full command run.

## Tests

- `npm run check`: PASS.
- `npm test`: PASS, 106/106.
- `AI_TU_RUNTIME_CONFIG_FILE=真实配置.json node tests/integration/provider-config.test.js`: PASS, `REAL_PROVIDER_CONFIG_PRESENT`.
- `node tests/integration/final-v1-4-evidence.test.js`: PASS, `FINAL_V1_4_EVIDENCE_SCAN_PASS`.
- `git diff --check`: PASS.
- review gate: pending final run.
- codegraph: pending final run.

## Browser Validation

Text image:
- POST result: HTTP 200, `status=succeeded`, image count 1.
- contract endpoint/model: `/v1/images/generations` + `gpt-image-2`.
- elapsed: 128754 ms.
- image GET: HTTP 200, `Content-Type: image/png`, `Cache-Control: no-store`.
- preview: visible.
- screenshot: `evidence/screenshots/browser-text-generation-edits-debug-20260615.png`.

Image edit:
- upload: `/api/reference-images` HTTP 200, MIME `image/jpeg`, size 382395 bytes.
- POST result: HTTP 502, `status=failed`, `error.code=PROMPT_IMAGE_BACKEND_UNAVAILABLE`, image count 0.
- contract endpoint/model: `/v1/images/edits` + `gpt-image-2`.
- elapsed: 10697 ms.
- image GET: not available because no image URL returned.
- screenshot: `evidence/screenshots/browser-image-generation-edits-debug-20260615.png`.

## Contract

- gpt-image-2 only: true.
- text generations only: true.
- image edits only: true.
- RAGFlow knowledge-driven template preserved: true.
- no hardcoded professional templates: true.
- structured references preserved: true.
- callback not executed: true.
- public `images[].url` only: true.
- no mock success: true.
- no high-concurrency claim: true.

## Decision

- allowed to push main: no.
- reason: real image edit browser path remains blocked by upstream/backend unavailable.
- allowed local commit to feature branch: yes, to preserve base64/binary normalizer fix, edits multipart `image[]`, route hardening, and expanded security scan.
- smallest remaining fixes: provider/upstream edits capability or account/backend availability investigation in Apifox/Memefast console; if upstream reports invalid multipart despite `image[]`, adjust only field name/filename/MIME/supported-field set.
