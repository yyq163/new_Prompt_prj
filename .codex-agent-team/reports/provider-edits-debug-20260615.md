# Provider Edits Debug Report 2026-06-15

FINAL_STATUS: PASS_MAIN01_BROWSER_RERUN_WITH_TRANSIENT_TEXT_FAILURE

Base64/binary normalizer repair, provider routing hardening, evidence redaction,
and automated tests pass. Latest real browser rerun verified image edit success;
text generation had one transient provider 502 and then passed on a fresh rerun.
No mock success was used. `main` was not pushed.

## Provider Contract

- Model: `gpt-image-2` only.
- Text endpoint kind: generations.
- Image endpoint kind: edits.
- Reference upload helper returns Generated Image Store URL for structured
  references.
- Provider reference fetch uses provider-layer SSRF checks and manual redirects.
- Poll/status URL is resolved before credentialed request construction.

## Normalizer Contract

- Accepts URL, `b64_json`, `base64`, `image_base64`, `data_url`,
  `data[0].image`, `data[0].result`, data URI, binary objects, and direct image
  HTTP response.
- Encoded/binary images enter Generated Image Store.
- Public API returns `images[].url` only.
- Invalid encoded values, wrong image magic, and mixed raw provider payloads are
  rejected without raw leakage.

## Browser Summary

- Text generation: first real browser run returned HTTP 502; fresh rerun
  returned HTTP 200, public status succeeded, image count 1, generated-image GET
  HTTP 200 image content and no-store.
- Image edit: upload HTTP 200 image/jpeg, final HTTP 200, public status
  succeeded, image count 1, generated-image GET HTTP 200 image content and
  no-store.

## Decision

`main01` is suitable as a protection branch after final clean verification and
push. This is not a release approval for `main`.
