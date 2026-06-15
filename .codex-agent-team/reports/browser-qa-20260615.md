**Status:** HISTORICAL — superseded by the screenshot-policy repair cycle.

# Browser QA Report 2026-06-15

Status: SUPERSEDED_BY_MAIN01_REPAIR

This older browser report is retained as historical text only. It must not be
used as current `main01` image-edit acceptance.

Current browser acceptance rules:

- Text generation must show HTTP 200, public status succeeded, visible preview,
  generated-image GET 200, image content type, and no-store cache control.
- Reference-backed image generation must use `/v1/images/edits` with
  `gpt-image-2`; latest `main01` rerun returned public success and
  generated-image GET no-store.
- Browser screenshots and request captures are retained as sanitized PNG and are tracked in
  the pushable branch.
- No provider success may be mocked.
