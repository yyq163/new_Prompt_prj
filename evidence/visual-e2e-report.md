# Visual E2E Evidence

Status: MAIN01_REDACTED_SUMMARY

This pushable evidence file records redacted browser status and retained
screenshots. Screenshots are retained as sanitized PNG files and tracked on
`main01`. Trace files and network captures remain ignored runtime artifacts.

This version was refreshed during the main01 HEAD, gitignore, and report repair
cycle.

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
- Browser evidence source for this repair is reused 2026-06-15 browser evidence;
  the browser main flow was not rerun in this repair cycle.
- `main01` is a clean protection branch candidate, not a `main` release.
- Pushed `main`: no.
- Allowed to merge `main`: no.
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
