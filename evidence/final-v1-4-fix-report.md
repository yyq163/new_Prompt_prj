# Final V1.4 Main01 Evidence

Status: MAIN01_PROTECTION_SUMMARY

This redacted artifact is part of the `main01` protection branch. It supersedes
older final-api evidence paths that are not present on the pushable branch. This
version was refreshed during the main01 HEAD, gitignore, and report repair
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
- Browser evidence source for this repair is reused 2026-06-15 browser evidence;
  the browser main flow was not rerun in this repair cycle.
- `main01` is a clean protection branch candidate only.
- Pushed `main`: no.
- Allowed to merge `main`: no.
- `origin/main` is outside the mutation scope.
- Final remote branch head must be verified by final command output.

## Evidence Policy

- `screenshots_policy=sanitized_png_retained`
- `screenshots_tracked=true`
- `screenshots_ignored=false`
- `.codex-agent-team/reports/**` is formal evidence and trackable.
- `.codex-agent-team/reports/browser-artifacts/` is ignored runtime artifact
  storage.
- `.codex-agent-team` runtime directories are ignored.
- `evidence/screenshots/**` is retained and trackable.

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
