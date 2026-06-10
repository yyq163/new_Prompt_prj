# CodeGraph Detailed Repository Report

Date: 2026-06-10

Project root: `/Volumes/App_Dev/new_Prompt_prj`

Baseline commit before evidence-chain correction: `0d7e945f0b57451075baf6a9851974ad45f71280`

This report is refreshed before the final evidence-chain commit. The commit that
contains this report must be verified after commit with `git log -1 --oneline`.
The report therefore records the true pre-commit baseline and the true current
index/worktree checks, rather than predicting a commit hash that would become
stale as soon as this file is committed.

## Verification State

CodeGraph was refreshed from the project root and checked after the evidence
cleanup.

Commands run for this report refresh:

```bash
python3 /Users/yyq/.codex/.codex-agent-team/scripts/code_indexer.py --root . --out .code-index
codegraph status --json
git status --short --untracked-files=all
```

Latest CodeGraph status:

```json
{
  "initialized": true,
  "projectPath": "/Volumes/App_Dev/new_Prompt_prj",
  "fileCount": 23,
  "nodeCount": 513,
  "edgeCount": 1312,
  "backend": "native",
  "languages": ["javascript"],
  "pendingChanges": {"added": 0, "modified": 0, "removed": 0}
}
```

Current pre-commit Git worktree changes are limited to evidence/report cleanup:

- update current Final V1.4 browser screenshots
- update Final V1.4 evidence summaries
- remove old visual screenshots that are not part of the Final V1.4 browser run
- refresh this CodeGraph report

After the final commit, `git status --short --untracked-files=all` must be
empty before claiming final closure.

## Indexed Source Files

```text
ai-tu/gateway/server.js
server.js
src/core/entity-mentions.js
src/core/errors.js
src/core/generated-image-response.js
src/core/generated-image-store.js
src/core/labels.js
src/core/prompt-compiler.js
src/core/ragflow-enhancement.js
src/core/reference-binding.js
src/core/runtime.js
src/core/url-security.js
src/core/legacy-api.js
src/providers/ai-tu-provider-adapter.js
src/providers/provider-result-normalizer.js
src/routes/image-generations.js
src/routes/prompt-optimizations.js
src/storage/generated-image-store.js
src/storage/trace-store.js
tests/integration/final-v1-4-evidence.test.js
tests/integration/provider-config.test.js
tests/unit/ai-tu-prompt-optimizer.test.js
tests/unit/image-api.test.js
```

`ai-tu/gateway/server.js` remains an indexed migration reference only. The final
service does not import it at runtime.

## Active Entry Points

`server.js` is the runtime entry point.

- `GET /health`: service health check.
- `GET /` and `GET /ai-image-generator.html`: serve the visible local page.
- `POST /api/prompt-optimizer`: old prompt optimization endpoint for the page.
- `POST /api/v1/prompt-optimizations`: prompt optimization alias.
- `POST /api/v1/image-generations`: Final Image Generation API V1.4 endpoint.
- `GET /api/v1/generated-images/:image_id`: temporary route for stored image bytes.
- Legacy `/api/image-jobs` remains compatibility-only and is not a Final V1.4
  acceptance endpoint.

## Final V1.4 Main Chain

The final image generation flow is:

1. `normalizeRequest` validates task type, references, output, callback URL, and generation mode.
2. `extractEntityMentions` extracts `@实体名` and `[实体名]`.
3. `resolveReferences` binds mentions by `entity_name` and keeps all valid references.
4. `getRagflowEnhancement` optionally requests structured enhancement.
5. `compilePrompt` builds backend-only upstream instructions.
6. `generateWithAiTuProvider` calls the real upstream provider.
7. `provider-result-normalizer.js` normalizes upstream image forms into public image URLs.
8. Public response returns `images[].url`, normalized mentions/references, warnings, and trace id.

Public responses remain sanitized: no backend-only prompt text, optional
enhancement state, upstream request details, raw image bytes, callback delivery
state, or credential material is returned.

## Reference Binding Status

Latest contract behavior is unchanged by this evidence-chain correction:

- `reference_id` must be unique.
- `references[].url` must be HTTP(S).
- `entity_name`, `role`, and `entity_type` are required.
- URL-only references are not supported.
- Empty-entity global references are not supported.
- `pattern_reference` aliases to `ornament_reference`.
- Legacy client `usage` input is accepted only for compatibility and ignored.
- `usage` is not returned in normalized public output.
- No primary, auxiliary, or weighting behavior is applied.
- Same `entity_name + role` with multiple images is allowed.
- A mention can bind to multiple `reference_id` values through `matched_reference_ids`.
- References that are not explicitly mentioned in the prompt are still included
  in reference guidance and upstream URL input.

Task-level reference rules:

- `text_image`: references are rejected.
- `image_reference`: at least one reference is required.
- `character_multiview`: references are optional; missing character material returns a warning.
- `scene_multiview`: references are optional; missing scene material returns a warning.
- `prop_multiview`: references are optional; missing prop/material/ornament material returns a warning.
- `storyboard`: pure text or mixed references are allowed.

## Schema Status

Supported `task_type` values:

- `text_image`
- `image_reference`
- `character_multiview`
- `scene_multiview`
- `prop_multiview`
- `storyboard`

Supported `role` values:

- `face_reference`
- `character_reference`
- `outfit_reference`
- `hair_reference`
- `prop_reference`
- `scene_reference`
- `style_reference`
- `composition_reference`
- `lighting_reference`
- `material_reference`
- `ornament_reference`
- `storyboard_reference`

Supported `entity_type` values:

- `character`
- `scene`
- `prop`
- `outfit`
- `hair`
- `style`
- `composition`
- `lighting`
- `material`
- `ornament`
- `storyboard`
- `other`

`output` constraints:

- `count`: 1-4
- `aspect_ratio`: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`
- `quality`: `standard`, `high`
- `return_format`: `url`
- `language`: `zh-CN`

## Callback Status

Current callback behavior is unchanged:

- accepts `callback_url`
- accepts `callback.url`
- validates public HTTP(S) URL
- rejects localhost, loopback, link-local, private network ranges, IPv6 local/private ranges, and non-HTTP(S) schemes by default
- does not create callback jobs
- does not send callback requests
- does not return callback delivery state
- records only callback presence in sanitized trace metadata

## Generated Image Store

`src/core/generated-image-store.js` and
`GET /api/v1/generated-images/:image_id` provide temporary access to real
upstream image bytes.

Implemented controls:

- random, non-enumerable `image_id`
- default TTL: 1 hour
- `GENERATED_IMAGE_TTL_MS`
- `GENERATED_IMAGE_MAX_COUNT`
- `GENERATED_IMAGE_MAX_BYTES`, default 20 MB
- MIME whitelist: `image/png`, `image/jpeg`, `image/webp`
- magic-byte MIME validation
- cleanup, get, delete, and test clear helpers
- response headers: `Content-Type`, `Content-Length`, `Cache-Control: no-store`
- expired or missing images return 404

The store is an in-memory default and is shaped so it can be replaced by object
storage later. It is not a reference upload store.

## Evidence Paths

Current Final V1.4 evidence paths:

- Visual E2E report: `evidence/visual-e2e-report.md`
- Network summary: `evidence/final-v1-4-network-summary.json`
- Compatibility network summary: `evidence/network-summary.json`
- Fix report: `evidence/final-v1-4-fix-report.md`
- Filled-form screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Final screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`

Old visual screenshots that are not part of the current browser run were removed
from `evidence/screenshots/` so the final evidence directory no longer mixes old
and current acceptance artifacts.

## Current Browser Evidence

Current browser run:

- Browser surface: Codex-controlled Chrome after Codex in-app Browser attach timeout
- Page: `http://127.0.0.1:8791/`
- Endpoint: `POST /api/v1/image-generations`
- HTTP status: `200`
- API status: `succeeded`
- Trace id: `trace_3d272cf798ba4bac96`
- Generation id: `gen_1961e101c1a6419b8d`
- Reference count: `3`
- Image count: `1`
- Generated image route: `GET /api/v1/generated-images/:image_id`
- Generated image GET: HTTP `200`, `Content-Type=image/png`, `Content-Length=3011403`, `Cache-Control=no-store`

## Test Results

Final pre-commit command results:

```text
npm run check: pass
npm test: pass, 71 tests
node tests/integration/provider-config.test.js: pass, REAL_PROVIDER_CONFIG_PRESENT
node tests/integration/final-v1-4-evidence.test.js: pass, FINAL_V1_4_EVIDENCE_SCAN_PASS
git diff --check: pass
python3 /Users/yyq/.codex/.codex-agent-team/scripts/review_gate.py --report .codex-agent-team/reports/review-T1-final-image-api-service.json: pass
codegraph status --json: pass, pendingChanges added=0 modified=0 removed=0
git status --short --untracked-files=all: expected evidence/report changes before commit
```

After the final commit, `git status --short --untracked-files=all` must be empty
before claiming final closure.

## Concurrency Status

See `docs/concurrency-status.md`.

Current service supports concurrent HTTP requests, provider timeout/retry
basics, credential rotation, polling, and a bounded generated-image memory
store.

It does not yet implement a global task queue, global provider semaphore,
per-key concurrency controls, backpressure, persisted job state,
1000-concurrency traffic shaping, cancellation, queue recovery, or durable
resume.

This project must not claim industrial 1000-concurrency readiness.

## Remaining Work

- Keep deprecated legacy `/api/image-jobs` out of final V1.4 evidence.
- Replace memory Generated Image Store with object storage before multi-instance deployment.
- Add production SSRF policy review before enabling private-network reference URLs.
- Add queue and provider concurrency controls before high-concurrency production claims.
