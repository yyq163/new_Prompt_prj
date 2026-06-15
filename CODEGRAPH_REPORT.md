# CodeGraph Main01 Protection Report

Date: 2026-06-15

Project root: `/Volumes/App_Dev/new_Prompt_prj`

This report describes the current `main01` protection branch only. It is not a
claim that `main` has passed release review.

## Branch State

- Protection branch: `main01`.
- Initial repaired head before this follow-up: `030fbb8770f2cd0663a9ffc90fc1d971ea9a77c8`.
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
- Reference image download now has provider-layer SSRF defense in addition to
  request normalization.

## Normalizer Contract

The provider normalizer accepts these provider image result forms only on the
server side:

- `b64_json`
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

Pushable evidence is limited to redacted text summaries. Screenshots, trace
files, network captures, logs, complete generated-image links, credentials, raw
provider bodies, and encoded image data are not part of the pushable evidence
set.

Older reports that implied image edit was still blocked are superseded for
`main01` by the latest real browser rerun. The rerun did not save screenshots,
trace files, network captures, raw provider bodies, credentials, or encoded
image payloads.

Latest redacted browser result:

- Text generation: one transient provider HTTP 502 was observed, then a fresh
  browser rerun returned HTTP 200, public status succeeded, one public image
  URL, and generated-image GET HTTP 200 with image content type and no-store
  cache control.
- Image edit: real local test image upload returned HTTP 200, the final request
  returned HTTP 200, public status succeeded, one public image URL, and
  generated-image GET HTTP 200 with image content type and no-store cache
  control.

## Verification To Refresh Before Final Push

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
latest real browser success for `main01`, plus one transient text-generation
502 observed immediately before the successful text rerun. It does not authorize
pushing or merging `main`.
