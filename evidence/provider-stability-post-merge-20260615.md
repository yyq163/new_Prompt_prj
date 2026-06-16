# Provider Stability Evidence

Status: SUPERSEDED_BY_MAIN01_REPAIR

Older provider-stability evidence is superseded by the `main01` protection
branch repair. Any earlier visual success wording must not be used to claim
current edits-chain PASS.

This file was refreshed during the main01 HEAD, gitignore, and report repair
cycle.

Current protected contracts:

- `gpt-image-2` only.
- Text generation uses `/v1/images/generations`.
- Reference-backed image generation uses `/v1/images/edits`.
- Provider encoded and binary image forms are accepted only server-side and are
  converted into Generated Image Store URLs.
- Public API returns URL-only images and no raw provider material.
- Third-party poll/status URLs never receive provider credentials.
- Real image edit upstream status is superseded by the latest `main01` browser
  rerun: upload, edits request, public success, and generated-image GET no-store
  all passed.

This is protection-branch evidence only; `main` is not pushed or merged.
`main01` is a clean protection branch candidate, not a `main` release. The final
remote branch head must be verified by final command output.

## Screenshot Policy

- `screenshots_policy`: `sanitized_png_retained`
- `screenshots_tracked`: `true`
- `screenshots_ignored`: `false`
- `.codex-agent-team/reports/**`: trackable formal evidence
- `.codex-agent-team/reports/browser-artifacts/`: ignored runtime artifact
  storage
- `.codex-agent-team` runtime directories: ignored
- `evidence/screenshots/**`: retained and trackable

Retained screenshots under `evidence/screenshots/` are sanitized UI captures. They
do not contain API keys, Authorization headers, Cookies, raw provider bodies,
raw base64 or inline image data payloads, runtime configs, or `真实配置.json`
content.
