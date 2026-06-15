**Status:** HISTORICAL — superseded by the screenshot-policy repair cycle.

# Provider Poll URL Subagent Summary - 2026-06-15

## Security Reviewer

- Initial finding: provider-returned third-party `status_url/poll_url` could be fetched with provider `Authorization`.
- Required fix: reject third-party/local/private/malformed poll URLs before fetch, preserve same-origin approved provider routes.

## Provider Config Reviewer

- Initial finding: poll base sanitization needed alignment with runtime allowlist.
- Fixed with `/v1/` path requirement and local/private rejection for configured poll base.

## Code Reviewer

- First review after P1 fix found release blockers:
  - Client/clarification errors were over-folded into backend invalid response.
  - `fetchUpstream` called `initFactory` before credential null check.
  - Relative poll URL resolution needed tighter handling.
- Second review found another release blocker:
  - Provider binary/direct image response contract and implementation diverged.
- Applied repairs:
  - Client/clarification public code/status preservation.
  - Credential null check before init factory.
  - Poll URL allowlist and relative path rules.
  - Binary/direct image response normalization to Generated Image Store URL.

## Test Reviewer

- Confirmed P1 poll URL authorization coverage after expansion:
  - evil absolute, protocol-relative, malformed, file/javascript, credentials, localhost/private/link-local/IPv6 unsafe rejection.
  - same-origin absolute and relative allowed forms.
  - rejection before fetch/Authorization.
  - routing/model, RAGFlow discard/fallback, invalid body, callback, Generated Image Store regressions.

## Browser QA

- Text-to-image: real browser flow with the local real runtime config reached success after a long upstream wait. Generated image preview rendered, and generated-image GET returned `200`, `Content-Type: image/png`, and `Cache-Control: no-store`.
- Image-to-image: real browser upload succeeded using the text-to-image output as a reference image. `/api/reference-images` returned `200`; the final `/api/v1/image-generations` request waited on the upstream connection and then returned `502` with public error `PROMPT_IMAGE_BACKEND_UNAVAILABLE`. This was not mocked as success.
- Evidence artifacts: tracked sanitized screenshots and browser captures, tracked on `main01`.

## Final Integrator

- Automated tests and gates pass.
- Code-level acceptance and privacy gates pass after the binary/direct image provider-result repair.
- Final release acceptance wording is superseded by the latest `main01` browser
  rerun, where image edit passed. `main01` may still be pushed only as a
  protection branch, not as a release/main PASS.
