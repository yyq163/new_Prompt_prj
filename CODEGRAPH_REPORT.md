# CodeGraph Main01 Protection Report

Date: 2026-06-15

Project root: `/Volumes/App_Dev/new_Prompt_prj`

This report describes the current `main01` protection branch only. It is not a
claim that `main` has passed release review.

This version was refreshed during the evidence-chain security contradiction
repair cycle.

## Branch State

- Protection branch: `main01`.
- Remote main base: `751b3013a0526f031c04d08946516d5e46cb6a01`.
- Local `main`: ahead of `origin/main` and intentionally untouched.
- Push target for this run: `origin/main01` only.
- Push target for `main`: no.

## Current Contracts

- Provider model is fixed to `gpt-image-2`.
- Text or no-reference requests use `/v1/images/generations`.
- Reference-backed requests use `/v1/images/edits`.
- No `gpt-image-2-all`, `gpt-image-1`, `dall-e-*`, or fallback model may enter
  provider payloads.
- Third-party poll/status URLs must not receive provider credentials.
- Reference image download has provider-layer SSRF defense in addition to
  request normalization.

## Normalizer Contract

The provider normalizer accepts these provider image result forms on the
server side:

- `provider encoded image field`
- `base64`
- `image_base64`
- `data_url`
- `data[0].image`
- `data[0].result`
- inline image data URI strings
- binary objects and direct image HTTP responses

Encoded or binary provider images are validated by image magic bytes and stored
in Generated Image Store. Public API responses expose only `images[].url`.
Invalid encoded bytes, wrong image magic, or mixed raw-provider payloads fail
instead of silently falling through to another candidate.

## RAGFlow And Prompt Compiler

- Prompt Compiler fallback no longer injects hardcoded professional templates
  for character, scene, prop, or storyboard tasks.
- RAGFlow enhancement is knowledge-driven JSON only.
- RAGFlow may not return final prompt text, compiled prompt text, reference
  IDs, URLs, or binding decisions such as primary, auxiliary, priority, or
  weight.
- Structured references remain controlled by the request contract.
- Callback inputs are validated but callback delivery is not executed.

## Evidence Policy

Pushable evidence includes redacted text summaries and sanitized screenshot PNG
files under `evidence/screenshots/`. Screenshot files are retained and tracked;
complete prompt text, complete reference URLs, and URL input fields are covered
by visible sanitization overlays. The retained screenshots do not include API
keys, Authorization headers, Cookies, raw provider request/response bodies, raw
base64 or inline image data payloads, runtime config files, or `真实配置.json`
content.

Trace files, network captures, logs, complete generated-image links,
credentials, raw provider bodies, and encoded image data are not part of the
pushable evidence set.

`.codex-agent-team/reports/*.md` and `.codex-agent-team/reports/*.json` are
tracked as controlled evidence-chain files. `.codex-agent-team/reports/browser-artifacts/`
and other `.codex-agent-team/` runtime artifacts are ignored.

Latest redacted browser result:

- Text generation: real browser rerun returned HTTP 200, public status
  succeeded, one public image URL, and generated-image GET HTTP 200 with image
  content type and no-store cache control.
- Image edit: real local test image upload returned HTTP 200, the final request
  returned HTTP 200, public status succeeded, one public image URL, and
  generated-image GET HTTP 200 with image content type and no-store cache
  control.

## Poll URL Authorization Security

A dedicated regression suite in `tests/unit/provider-poll-url-security.test.js`
covers:

- Evil third-party poll URLs are rejected before any fetch or Authorization.
- localhost, loopback, private, and link-local poll URLs are rejected.
- Malformed or dangerous-scheme poll URLs do not crash.
- Empty or whitespace `status_url` does not trigger an outbound fetch.
- Same-origin absolute poll URLs are allowed and receive Authorization only on
  the approved provider URL.
- Relative poll paths resolve against the approved provider origin/path.
- Rejected poll URLs do not leak Authorization or key in public responses.

## Verification Performed

- `npm run check`
- `npm test`
- `AI_TU_RUNTIME_CONFIG_FILE=真实配置.json node tests/integration/provider-config.test.js`
- `node tests/integration/final-v1-4-evidence.test.js`
- `git diff --check`
- `python3 /Users/yyq/.codex/.codex-agent-team/scripts/review_gate.py --report .codex-agent-team/reports/review-T1-ragflow-knowledge-driven-template.json`
- `codegraph sync . && codegraph status --json`
- `git status --short --untracked-files=all`

## Known Risk

Provider availability is still upstream-dependent. This report records the
latest real browser success for `main01`. It does not authorize pushing or
merging `main`.
