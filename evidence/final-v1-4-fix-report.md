# Final V1.4 Fix Evidence

Date: 2026-06-10

Status: pass after strict local checks and browser rerun

## Checks

- Contract endpoint checks: pass
- Callback public URL validation: pass
- Callback non-delivery behavior: pass
- Generated image GET metadata: pass
- Public response privacy scan: pass
- Evidence text scan: pass
- Browser visual E2E: pass
- Provider configuration integration: pass
- Whitespace diff check: pass

## Browser

- Page: `http://127.0.0.1:8791/`
- Browser surface: Codex-controlled Chrome browser after Codex in-app Browser attach timeout
- Screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Visible result: succeeded with generated image preview
- Trace id: `trace_3d272cf798ba4bac96`
- Generation id: `gen_1961e101c1a6419b8d`

## Generated Image GET

- HTTP status: `200`
- Content type: `image/png`
- Cache control: `no-store`
- Content length: `3011403`

## Callback

- Public HTTPS callback URL accepted: `true`
- Local and private callback URLs rejected: `true`
- Unsafe callback schemes rejected: `true`
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
- Production public base URL configuration is enforced for service-generated image URLs.
- Legacy route is deprecated and not a final acceptance endpoint.
- Industrial concurrency is not claimed.

## Evidence Directory

- `evidence/visual-e2e-report.md` describes the current Final V1.4 browser run.
- `evidence/final-v1-4-network-summary.json` and `evidence/network-summary.json` describe the same run.
- `evidence/screenshots/` keeps only the two current Final V1.4 browser screenshots.
- Ignored old visual result data and old visual screenshots were removed from the local evidence tree.
