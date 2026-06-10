# CodeGraph Detailed Repository Report

Date: 2026-06-10

Project root: `/Volumes/App_Dev/new_Prompt_prj`

Commit at report refresh: `e36b00b`

## Verification State

CodeGraph was refreshed from the project root and used as the structural source for this report.

Commands run:

```bash
codegraph status --json
codegraph files --json
npm run check
npm test
node tests/integration/provider-config.test.js
git diff --check
```

Latest CodeGraph status:

```json
{
  "initialized": true,
  "projectPath": "/Volumes/App_Dev/new_Prompt_prj",
  "fileCount": 20,
  "nodeCount": 468,
  "edgeCount": 1130,
  "backend": "native",
  "languages": ["javascript"],
  "pendingChanges": {"added": 0, "modified": 0, "removed": 0}
}
```

Generated code-map artifacts:

- `.understand-anything/knowledge-graph.json`
- `.understand-anything/code-map-report.md`
- `.understand-anything/code-map-report.html`
- `.understand-anything/code-map-summary.json`

The dashboard was not launched in this final closure run, so no local dashboard token is written into this durable report.

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
src/providers/ai-tu-provider-adapter.js
src/providers/provider-result-normalizer.js
src/routes/image-generations.js
src/routes/prompt-optimizations.js
src/storage/generated-image-store.js
src/storage/trace-store.js
tests/integration/provider-config.test.js
tests/unit/ai-tu-prompt-optimizer.test.js
tests/unit/image-api.test.js
```

`ai-tu/gateway/server.js` remains an indexed migration reference only. The final service does not import it at runtime.

## Active Entry Points

`server.js` is the current runtime entry point.

- `GET /health`: service health check.
- `GET /` and `GET /ai-image-generator.html`: serve the original ai-tu frontend page.
- `POST /api/prompt-optimizer`: prompt optimization endpoint used by the ai-tu page.
- `POST /api/v1/prompt-optimizations`: prompt optimization alias.
- `POST /api/v1/image-generations`: final PRD image generation API.
- `GET /api/v1/generated-images/:image_id`: temporary URL for real provider bytes normalized by the service.
- Legacy `/api/image-jobs` remains for compatibility but is not a PRD verification entrypoint.

## `/api/v1/image-generations` Main Chain

The final API flow is:

1. `normalizeRequest` validates task type, references, output, callback URL, and generation mode.
2. `extractEntityMentions` extracts `@实体名` and `[实体名]`.
3. `resolveReferences` binds mentions by `entity_name` and keeps all references.
4. `getRagflowEnhancement` optionally requests safe structured enhancement.
5. `compilePrompt` deterministically creates the internal provider prompt.
6. `generateWithAiTuProvider` calls the real upstream provider.
7. `provider-result-normalizer.js` converts URL/base64/data URL/binary provider results into public image URLs.
8. Public response returns `images[].url`, normalized mentions/references, warnings, and trace id.

The public response does not expose `final_prompt`, `compiled_prompt`, raw enhancement, RAGFlow state, fallback state, provider payload, base64 text, callback status, provider key, Authorization header, or Cookie.

## Reference Binding Status

Latest PRD behavior is implemented:

- `reference_id` must be unique.
- `references[].url` must be HTTP(S).
- `entity_name`, `role`, and `entity_type` are validated.
- URL-only references are not supported.
- Empty-entity global references are not supported.
- `pattern_reference` aliases to `ornament_reference`.
- `usage` is accepted for old clients but ignored.
- `usage` is not returned in `normalized.references_used`.
- No reference weighting field is applied.
- Same `entity_name + role` with multiple images is allowed.
- A mention can bind to multiple `reference_id` values through `matched_reference_ids`.
- References that are not explicitly mentioned in the prompt are still included in `references_used`, Prompt Compiler context, and provider URL input.

Task-level reference rules:

- `text_image`: references are forbidden and return `REFERENCES_NOT_ALLOWED`.
- `image_reference`: at least one reference is required and missing references return `REFERENCE_REQUIRED`.
- `character_multiview`: references are optional; missing face/character reference returns a warning, not a blocker.
- `scene_multiview`: references are optional; missing scene reference returns a warning, not a blocker.
- `prop_multiview`: references are optional; missing prop/material/ornament reference returns a warning, not a blocker.
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

## Prompt Compiler / RAGFlow Boundary

Prompt Compiler owns the final internal provider prompt. RAGFlow is only an optional structured enhancement source.

Implemented boundaries:

- RAGFlow missing configuration does not block the image generation chain unless explicitly required.
- Invalid JSON, field-summary output, `final_prompt`, unknown reference IDs, unknown URLs, and excessive enhancement content are discarded.
- References are compiled as equal-weight role-specific guidance.
- Unmentioned references are still included in reference guidance.
- Storyboard path analysis remains internal and is not returned publicly.

## Provider Result Normalizer

`src/providers/provider-result-normalizer.js` supports:

- external provider URL fields: `url`, `image_url`, `output_url`, `download_url`
- nested arrays: `images[]`, `data[]`, `output[]`
- `b64_json`
- `base64`
- `data:image/...;base64,...`
- binary `Buffer`, `ArrayBuffer`, and typed arrays
- direct binary HTTP image responses parsed by `fetchUpstreamOnce`

If the provider returns an external URL, the service returns that URL. If the provider returns real image bytes, the service stores them through Generated Image Store and returns `/api/v1/generated-images/:image_id`.

Failure mapping:

- provider call failure: `IMAGE_PROVIDER_CALL_FAILED`
- provider timeout: `IMAGE_PROVIDER_TIMEOUT`
- no image result: `IMAGE_RESULT_EMPTY`
- unsupported bytes/MIME/base64: `PROVIDER_RESPONSE_UNSUPPORTED`

## Generated Image Store

`src/core/generated-image-store.js` and `GET /api/v1/generated-images/:image_id` provide temporary access to real provider bytes.

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

The store is an in-memory default and is shaped so it can be replaced by object storage later. It is not a reference upload store.

## Callback Status

Current callback behavior is the C plan:

- accepts `callback_url`
- accepts `callback.url`
- validates HTTP(S) URL
- does not create callback jobs
- does not send callback requests
- does not return `callback_status`
- does not return `CALLBACK_NOT_IMPLEMENTED`
- records only callback presence in sanitized trace metadata

## Provider Adapter Migration

Detailed migration mapping is maintained in:

```text
docs/provider-adapter-migration-map.md
```

That map covers allowed provider config/auth/payload/call/retry/error/result normalization behavior and forbidden upload, imgbb, multipart, old UI, old response, and hardcoded secret behavior.

## Evidence Paths

- Visual E2E report: `evidence/visual-e2e-report.md`
- Network summary: `evidence/network-summary.json`
- Screenshot: `evidence/screenshots/final-image-generation-api-e2e.png`
- Filled-form screenshot: `evidence/screenshots/final-image-generation-api-e2e-before-submit.png`
- Code-map artifacts: `.understand-anything/`

Evidence files must not contain raw provider payloads, full base64 strings, Authorization headers, Cookies, provider keys, RAGFlow keys, internal prompts, or raw enhancement output.

## Test Results

Final closure results:

```text
npm run check: pass
npm test: pass, 67 tests
node tests/integration/provider-config.test.js: pass, REAL_PROVIDER_CONFIG_PRESENT
git diff --check: pass
Browser visual E2E: pass, trace_e54714c1b6874898ba, POST /api/v1/image-generations, HTTP 200, status=succeeded, image_count=1
Generated image GET: pass, Content-Type=image/png, Content-Length=2504876, Cache-Control=no-store
```

## Concurrency Status

See `docs/concurrency-status.md`.

Current service supports concurrent HTTP requests, provider timeout/retry basics, credential rotation, polling, and a bounded generated-image memory store.

It does not yet implement a global task queue, global provider semaphore, per-key concurrency controls, backpressure, persisted job state, 1000-concurrency traffic shaping, cancellation, queue recovery, or durable resume.

This project must not claim industrial 1000-concurrency readiness.

## Remaining Work

- Keep legacy `/api/image-jobs` out of final PRD evidence.
- Replace memory Generated Image Store with object storage before multi-instance deployment.
- Add production SSRF policy review before enabling private-network reference URLs.
- Add queue and provider concurrency controls before high-concurrency production claims.
