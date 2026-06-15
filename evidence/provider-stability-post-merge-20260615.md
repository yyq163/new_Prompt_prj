# Provider Stability Post-Merge Evidence 2026-06-15

## Scope

- Runtime config source: local `真实配置.json` was used for live verification.
- Sensitive values leaked: false.
- Raw provider request/response persisted: false.
- Mock success used: false.

## Fixed Provider Contract

- Model fixed: `gpt-image-2`.
- Text endpoint: `/v1/images/generations`.
- Image endpoint: `/v1/images/edits`.
- Other model fallback used: false.
- `gpt-image-2-all`, `gpt-image-1`, and `dall-e-*` usage in current adapter path: false.

## Browser Acceptance

Text-to-image:

- Browser surface: Codex in-app browser.
- Page: `http://127.0.0.1:8793/`.
- Page submit endpoint: `/api/v1/image-generations`.
- HTTP result: 200, `status=succeeded`.
- Public image URL: local Generated Image Store URL only.
- GET generated image: 200, `Content-Type=image/png`, `Cache-Control=no-store`.
- Screenshot: `evidence/screenshots/browser-text-generation-20260615.png`.
- Upstream console: Memefast usage log showed a latest `gpt-image-2` consumption row after the request.

Image-to-image:

- Browser surface: Playwright real browser.
- Upload path: page file input to `POST /api/reference-images`, HTTP 200.
- Page submit endpoint: `/api/v1/image-generations`, HTTP 200.
- Provider mode: reference-backed `image_to_image`.
- Public image URL: local Generated Image Store URL only.
- GET generated image: 200, `Content-Type=image/png`, `Cache-Control=no-store`.
- Screenshot: `evidence/screenshots/browser-image-generation-20260615.png`.
- Request summary: `.codex-agent-team/reports/browser-artifacts/playwright-requests-20260615.txt`.

## Verification Commands

- `npm run check`: pass.
- `npm test`: pass, 92 tests.
- `AI_TU_RUNTIME_CONFIG_FILE=真实配置.json node tests/integration/provider-config.test.js`: pass.
- `node tests/integration/final-v1-4-evidence.test.js`: pass.

## Contract Guards Confirmed

- `references[]` remains structured: `reference_id`, `entity_name`, `entity_type`, `role`, and `url`.
- URL-only references remain rejected.
- Callback is validated only and not executed.
- Usage is ignored and not returned.
- Public responses do not expose internal prompts, provider payloads, base64, enhancement, or storyboard path.
- RAGFlow knowledge-driven template behavior remains covered by unit tests.
