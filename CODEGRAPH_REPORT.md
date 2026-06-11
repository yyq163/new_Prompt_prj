# CodeGraph Detailed Repository Report

Date: 2026-06-11

Project root: `/Volumes/App_Dev/new_Prompt_prj`

Baseline commit before RAGFlow knowledge-driven template correction: `751b3013a0526f031c04d08946516d5e46cb6a01`

This report is refreshed before the RAGFlow knowledge-driven template correction commit. The commit that
contains this report must be verified after commit with `git log -1 --oneline`.
The report therefore records the true pre-commit baseline and the true current
index/worktree checks, rather than predicting a commit hash that would become
stale as soon as this file is committed.

## Verification State

CodeGraph was refreshed from the project root and checked during the RAGFlow
knowledge-driven template repair.

Commands run for this report refresh:

```bash
python3 /Users/yyq/.codex/.codex-agent-team/scripts/code_indexer.py --root . --out .code-index
codegraph status --json
git status --short --untracked-files=all
```

Initial CodeGraph status before production edits:

```json
{
  "initialized": true,
  "projectPath": "/Volumes/App_Dev/new_Prompt_prj",
  "fileCount": 24,
  "nodeCount": 529,
  "edgeCount": 1342,
  "backend": "native",
  "languages": ["javascript"],
  "pendingChanges": {"added": 0, "modified": 0, "removed": 0}
}
```

After production and test edits, CodeGraph must be checked again before commit.

Current pre-commit Git worktree changes are limited to the knowledge-driven
template repair:

- remove unconditional professional template detail from `src/core/prompt-compiler.js`
- add `missing_constraints` to `TYPE_SCHEMAS.RagflowEnhancement`
- add regression tests for minimal fallback, enhancement consumption, and RAGFlow discard policy
- add RAGFlow system prompt and knowledge seed documents
- update Final V1.4 contract, design, and evidence summaries
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
tests/unit/http-invalid-body.test.js
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

Malformed JSON and oversized request bodies are rejected in `server.js` before
the final image generation handler or prompt optimization handler runs. The
public response is HTTP 400, `status=failed`, and
`error_code=INVALID_REQUEST_SCHEMA`.

## Final V1.4 Main Chain

The final image generation flow is:

1. `normalizeRequest` validates task type, references, output, callback URL, and generation mode.
2. `extractEntityMentions` extracts `@实体名` and `[实体名]`.
3. `resolveReferences` binds mentions by `entity_name` and keeps all valid references.
4. `getRagflowEnhancement` optionally requests structured knowledge-driven enhancement.
5. `compilePrompt` builds backend-only upstream instructions from minimal local fallback plus validated enhancement fields.
6. `generateWithAiTuProvider` calls the real upstream provider.
7. `provider-result-normalizer.js` normalizes upstream image forms into public image URLs.
8. Public response returns `images[].url`, normalized mentions/references, warnings, and trace id.

Public responses remain sanitized: no backend-only prompt text, optional
enhancement state, upstream request details, raw image bytes, callback delivery
state, or credential material is returned.

## Prompt Compiler and RAGFlow Knowledge Status

`src/core/prompt-compiler.js` no longer unconditionally injects full
professional templates for `character_multiview`, `scene_multiview`,
`prop_multiview`, or `storyboard`.

Local fallback now keeps only:

- task type
- original user prompt
- deterministic reference binding
- output description
- minimal per-task consistency/safety text
- common negative rules

Specific professional template content is expected from validated RAGFlow
enhancement or explicit user prompt content. The compiler appends supported
enhancement fields including `scene_summary`, `visual_focus`,
`story_function`, `action_stages`, `shot_plan`, `normalized_shot_plan`,
`lighting_notes`, `composition_notes`, `negative_notes`, and
`missing_constraints`.

RAGFlow system prompt and knowledge seed files were added under
`docs/ragflow/`. These files are documentation and ingestion material; runtime
code does not read them directly.

## Reference Binding Status

Latest contract behavior is unchanged by this HTTP invalid body correction:

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

- Browser surface: Codex in-app Browser
- Page: `http://127.0.0.1:8792/`
- Endpoint: `POST /api/v1/image-generations`
- HTTP status: `200`
- API status: `succeeded`
- Trace id: `trace_498493fb085144d8ac`
- Generation id: `gen_eb0bdb009b9842babe`
- Reference count: `0`
- Image count: `1`
- Generated image route: `GET /api/v1/generated-images/:image_id`
- Generated image GET: HTTP `200`, `Content-Type=image/png`, `Content-Length=3118845`, `Cache-Control=no-store`

## Test Results

Final pre-commit command results:

```text
npm run check: pass
npm test: pass, 73 tests
node --test tests/unit/http-invalid-body.test.js: pass, malformed and oversized body cases
node tests/integration/provider-config.test.js: pass, REAL_PROVIDER_CONFIG_PRESENT
node tests/integration/final-v1-4-evidence.test.js: pass, FINAL_V1_4_EVIDENCE_SCAN_PASS
git diff --check: pass
python3 /Users/yyq/.codex/.codex-agent-team/scripts/review_gate.py --report .codex-agent-team/reports/review-T1-final-image-api-service.json: pass
codegraph index --force: pass, indexed 24 files
codegraph status --json: pass, pre-commit pendingChanges added=1 modified=0 removed=0 for the new indexed test file
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
