# Visual E2E Evidence

Status: MAIN01_REDACTED_SUMMARY

This pushable evidence file records only redacted browser status. Screenshots
and trace or network captures are local-only artifacts and are not tracked on
`main01`.

This version was refreshed during the evidence-chain security contradiction
repair cycle.

## Current Acceptance Meaning

- Text generation: latest real browser rerun returned HTTP 200, public status
  succeeded, one image, generated-image GET 200, image content type, and no-store
  cache control.
- Image edit: latest real browser upload and edits request returned HTTP 200,
  public status succeeded, one image, generated-image GET 200, image content
  type, and no-store cache control.
- No mock success is accepted.
- This is protection-branch evidence only and does not authorize pushing or
  merging `main`.

## Privacy

This file intentionally omits prompts, complete generated-image links, reference
links, request headers, response bodies, credentials, screenshots, trace files,
network captures, and encoded image data.
