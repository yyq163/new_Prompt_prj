# Visual E2E Evidence

Status: MAIN01_REDACTED_SUMMARY

This pushable evidence file records redacted browser status and retained
screenshots. Screenshots are retained as sanitized PNG files and tracked on
`main01`. Trace files and network captures remain ignored runtime and are ignored.

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

## Screenshot Security

Retained screenshots under `evidence/screenshots/` are sanitized PNG UI captures.
They contain only the browser interface, test prompts, and generated images. They
do not contain API keys, Authorization headers, Cookies, raw provider
request/response bodies, raw base64 or inline image data payloads, runtime
config files, or `真实配置.json` content.

## Privacy

This text file intentionally omits prompts, complete generated-image links,
reference links, request headers, response bodies, credentials, trace files,
network captures, and encoded image data. Retained screenshot files are covered
by the Screenshot Security section above.
