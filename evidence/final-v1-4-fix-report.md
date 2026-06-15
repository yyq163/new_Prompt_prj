# Final V1.4 Main01 Evidence

Status: MAIN01_PROTECTION_SUMMARY

This redacted artifact is part of the `main01` protection branch. It supersedes
older final-api evidence paths that are not present on the pushable branch. This
version was refreshed after the evidence-chain security contradiction repair
cycle.

## Provider Boundary

- Provider URL responses may be returned only after public URL validation.
- Provider encoded and binary image responses may be accepted only server-side.
- Server-side encoded or binary images are validated and stored in Generated
  Image Store.
- Public responses expose only `images[].url`.
- Invalid encoded bytes, wrong image magic, and mixed raw-provider payloads fail
  without raw leakage.
- Third-party poll/status URLs never receive provider credentials.

## Browser State

- Text generation: latest real browser rerun returned HTTP 200, public status
  succeeded, one image, generated-image GET 200, image content type, and no-store
  cache control.
- Image edit: latest real browser upload and edits request returned HTTP 200,
  public status succeeded, one image, generated-image GET 200, image content
  type, and no-store cache control.
- This file does not claim main release PASS or authorize pushing `main`.
- Screenshots are retained as sanitized PNG files and tracked.

## Screenshot Security

Retained screenshots are sanitized PNG UI captures. They show only the browser
interface, test prompts, and generated images. They do not contain API keys,
Authorization headers, Cookies, raw provider request/response bodies, raw
base64 or inline image data payloads, runtime config files, or `真实配置.json`
content.

## Privacy

No credentials, raw provider request or response body, full reference link,
complete generated-image link, trace, network capture, or encoded image payload
is recorded here.
