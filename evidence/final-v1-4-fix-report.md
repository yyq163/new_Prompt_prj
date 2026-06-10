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
- Browser surface: Codex-controlled Chrome browser after in-app Browser attach timeout
- Screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Visible result: succeeded with generated image preview
- Trace id: `trace_566adaa7bda24623b5`
- Generation id: `gen_1a1bc7c910a94647a3`

## Generated Image GET

- HTTP status: `200`
- Content type: `image/png`
- Cache control: `no-store`
- Content length: `2403683`

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
