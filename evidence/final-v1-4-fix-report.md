# Final V1.4 Fix Evidence

Date: 2026-06-11

Status: pass after HTTP invalid body repair, local checks, and browser rerun

## P1 Repair

- `POST /api/v1/image-generations` now rejects malformed JSON at the HTTP layer with `400 INVALID_REQUEST_SCHEMA`.
- `POST /api/v1/image-generations` now rejects oversized request bodies at the HTTP layer with `400 INVALID_REQUEST_SCHEMA`.
- `POST /api/v1/prompt-optimizations` now uses the same HTTP invalid body handling.
- Deprecated `/api/image-jobs` keeps its compatibility behavior while sharing the same invalid body check.
- Invalid body responses return only safe public error fields.

## HTTP Invalid Body Tests

- Image generation malformed JSON: pass, message contains `请求体不是合法 JSON`.
- Image generation oversized body: pass, message contains `请求体过大`.
- Prompt optimization malformed JSON: pass, message contains `请求体不是合法 JSON`.
- Prompt optimization oversized body: pass, message contains `请求体过大`.
- Legal Final V1.4 JSON still enters the normal provider-gated path: pass.
- Public error response leak scan: pass.

Command:

```bash
node --test tests/unit/http-invalid-body.test.js
```

## Browser

- Page: `http://127.0.0.1:8792/`
- Browser surface: Codex in-app Browser
- Screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Visible result: succeeded with generated image preview
- Trace id: `trace_498493fb085144d8ac`
- Generation id: `gen_eb0bdb009b9842babe`

## Generated Image GET

- Image id: `img_f95359394abc49bcb5be11f025bc86ea`
- HTTP status: `200`
- Content type: `image/png`
- Cache control: `no-store`
- Content length: `3118845`

## Callback

- Public HTTPS callback URL accepted by contract tests: `true`
- Local and private callback URLs rejected by contract tests: `true`
- Unsafe callback schemes rejected by contract tests: `true`
- Callback delivery attempted: `false`
- Callback task returned: `false`

## Contract Summary

- Structured references remain required.
- URL-only references remain unsupported.
- Empty-entity global references remain unsupported.
- Old priority and weight concepts remain absent.
- Legacy client `usage` input remains ignored.
- Public image output remains URL-only.
- Provider success is not mocked.
- Production public base URL configuration remains enforced for service-generated image URLs.
- Legacy route is deprecated and not a final acceptance endpoint.
- Industrial concurrency is not claimed.

## Evidence Directory

- `evidence/visual-e2e-report.md` describes the current Final V1.4 browser run.
- `evidence/final-v1-4-network-summary.json` and `evidence/network-summary.json` describe the same run.
- `evidence/screenshots/` keeps the current Final V1.4 browser screenshots.
