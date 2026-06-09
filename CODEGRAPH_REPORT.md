# CodeGraph Detailed Repository Report

Date: 2026-06-09

Project root: `/Volumes/App_Dev/new_Prompt_prj`

## Verification State

CodeGraph was refreshed from the project root and used as the structural source of truth for this report.

Commands run:

```bash
python3 ~/.codex/skills/code-map/scripts/code_map_pipeline.py --root . --dashboard
npm run check
npm test
```

CodeGraph status after refresh:

```json
{
  "initialized": true,
  "projectPath": "/Volumes/App_Dev/new_Prompt_prj",
  "fileCount": 17,
  "nodeCount": 418,
  "edgeCount": 1125,
  "backend": "native",
  "languages": ["javascript"],
  "nodesByKind": {
    "class": 1,
    "constant": 60,
    "file": 17,
    "function": 270,
    "import": 65,
    "method": 1,
    "variable": 4
  }
}
```

Generated code-map artifacts:

- `.understand-anything/knowledge-graph.json`
- `.understand-anything/code-map-report.md`
- `.understand-anything/code-map-report.html`
- `.understand-anything/code-map-summary.json`
- Dashboard URL: `http://127.0.0.1:5175/?token=f70c3623a734606b4ee294e83c11f0ed`

## Indexed Source Tree

CodeGraph indexed the JavaScript runtime and tests:

```text
server.js
ai-tu/gateway/server.js
src/core/entity-mentions.js
src/core/errors.js
src/core/labels.js
src/core/prompt-compiler.js
src/core/ragflow-enhancement.js
src/core/reference-binding.js
src/core/runtime.js
src/providers/ai-tu-provider-adapter.js
src/routes/image-generations.js
src/routes/prompt-optimizations.js
src/storage/generated-image-store.js
src/storage/trace-store.js
tests/integration/provider-config.test.js
tests/unit/ai-tu-prompt-optimizer.test.js
tests/unit/image-api.test.js
```

The repository also contains PRD/spec/design documents, visual evidence, and the ai-tu HTML frontend. Those files are covered in this handoff even when they are not JavaScript symbols in CodeGraph.

## Runtime Entry Points

`server.js` is the service entry point started by `npm start`.

HTTP routes:

- `GET /health`: health check.
- `GET /` and `GET /ai-image-generator.html`: serve the existing ai-tu frontend at `ai-tu/ai-image-generator.html`.
- `POST /api/prompt-optimizer`: ai-tu prompt optimization entry.
- `POST /api/v1/prompt-optimizations`: alias for prompt optimization.
- `POST /api/v1/image-generations`: final image generation API.
- `GET /api/v1/generated-images/:id`: short-lived in-memory image URL for real upstream image bytes returned as base64.
- `POST /api/image-jobs` and `GET /api/image-jobs/:id`: legacy ai-tu-compatible route.

The root route deliberately serves the ai-tu original page rather than the discarded standalone console.

## Major Layers

### Frontend

`ai-tu/ai-image-generator.html` is the active browser page at `http://127.0.0.1:8787/`.

Current responsibilities:

- Preserve the original ai-tu page and generation workflow.
- Add prompt optimization controls.
- Let the user select all 6 PRD `task_type` values.
- Collect structured `references[]` fields.
- Call `POST /api/prompt-optimizer` for prompt optimization.
- On prompt optimization success, overwrite the original ai-tu prompt textarea with `optimized_prompt`.
- Call `POST /api/v1/image-generations` from the visible `开始生成` button.
- Render returned image URLs and previews.
- Avoid rendering internal fields such as compiled prompt, enhancement, fallback state, provider payload, callback status, or secrets.

### Prompt Optimization Route

`src/routes/prompt-optimizations.js` implements the deterministic prompt optimizer / compiler.

Primary flow:

1. `handlePromptOptimization`.
2. Normalize request and output schema.
3. Extract entity mentions from `@实体名` and `[实体名]`.
4. Validate and resolve `references[]`.
5. Build a dynamic reference plan.
6. Optionally call RAGFlow for structured enhancement.
7. Validate enhancement.
8. Compile backend-owned `optimized_prompt` for 6 task types.
9. Validate public prompt quality and return a public response.

RAGFlow is an optional enhancement layer, not the final prompt author. The backend Prompt Compiler owns the final `optimized_prompt`.

### Final Image Generation Route

`src/routes/image-generations.js` implements `POST /api/v1/image-generations`.

Primary flow:

1. `normalizeRequest` validates schema and callback fields.
2. `extractEntityMentions` reads prompt mentions.
3. `resolveReferences` deterministically binds references.
4. `getRagflowEnhancement` optionally adds safe structured enhancement.
5. `compilePrompt` builds the internal provider prompt.
6. `generateWithAiTuProvider` calls the real upstream provider.
7. The route returns public images, normalized mentions/references, warnings, and trace id.

The public response does not expose final prompt, compiled prompt, raw enhancement, fallback state, provider payload, provider key, callback status, or internal debug data.

### Provider Adapter

`src/providers/ai-tu-provider-adapter.js` contains the migrated real-provider capability from ai-tu gateway logic.

Implemented provider capabilities:

- Runtime configuration from environment variables or ai-tu runtime config.
- Endpoint validation.
- API key selection without public exposure.
- Authorization bearer request construction.
- JSON text-to-image payload.
- JSON image-to-image URL payload.
- Long-running submit timeout for real image generation.
- No automatic retry for non-idempotent image-generation submission.
- Retry/retry-after logic for appropriate follow-up requests.
- Provider URL response mapping.
- Provider base64 image response mapping via real upstream bytes.
- Async submit + poll support when upstream returns a task handle.
- Public error mapping.

Important real-provider fix:

- The upstream relay returned successful images as `data[0].b64_json`, not an external URL.
- The adapter now accepts real upstream base64 image bytes, stores them in memory through `src/storage/generated-image-store.js`, and returns a short-lived URL under `/api/v1/generated-images/<id>`.
- This is not mock data and not fake success; the bytes are from the real upstream provider response.
- No imgbb upload, multipart upload, or local file conversion is used.

### Storage

`src/storage/generated-image-store.js`

- Holds real upstream image bytes in memory for short-lived browser preview.
- Returns `/api/v1/generated-images/<id>` paths.
- Enforces TTL and a small maximum image count.

`src/storage/trace-store.js`

- Writes sanitized trace metadata only.
- Stores endpoint, method, ids, task type, generation mode, prompt hash, reference count, image count, status, and error code.
- Does not store prompt text, provider payload, provider key, Authorization header, Cookie, or upstream raw output.

## PRD Task Coverage

Supported `task_type` values:

- `text_image`
- `image_reference`
- `character_multiview`
- `scene_multiview`
- `prop_multiview`
- `storyboard`

`generation_mode` is separate from `task_type`:

- `references[]` empty -> `text_to_image`.
- `references[]` non-empty -> `image_to_image`.

TASK-1 callback:

- Accepts `callback_url` and `callback`.
- Does not execute callback.
- Does not block the main generation chain.
- Does not return `callback_status`.
- `CALLBACK_NOT_IMPLEMENTED` no longer affects normal requests.

TASK-2 schema:

- Role enum aligned to PRD, including `face_reference`, `material_reference`, `ornament_reference`, `lighting_reference`, and `composition_reference`.
- `pattern_reference` aliases to `ornament_reference`.
- `entity_type` uses a strict enum.
- `output.count` is restricted to `1-4`.
- `aspect_ratio`, `quality`, and `language` use strict enums.

TASK-3 primary reference rules:

- `character_multiview` allows primary `face_reference` or `character_reference`.
- `scene_multiview` allows primary `scene_reference`, `lighting_reference`, or `composition_reference`.
- `prop_multiview` allows primary `prop_reference`, `material_reference`, or `ornament_reference`.
- `image_reference` requires at least one reference.
- `storyboard` can be pure text.
- `text_image` forbids references.

TASK-4 single reference default primary:

- One reference for the same `entity_name + role` with empty `usage` is normalized to `primary`.
- Multiple references for the same `entity_name + role` with empty `usage` still block.
- Multiple primary references still block.

TASK-5 final visual E2E evidence:

- Page triggered `POST /api/v1/image-generations`.
- Page filled `references[].url`, `entity_name`, `role`, and `usage`.
- Real provider was called.
- Provider returned one real image through upstream bytes.
- Page displayed a real image preview.
- `evidence/network-summary.json` proves endpoint, HTTP 200, trace id, image count, and image preview visibility.

## Current Verification Results

Automation:

```text
npm run check: pass
npm test: pass, 54 tests
```

Browser evidence:

- Screenshot: `evidence/screenshots/final-image-generation-api-e2e.png`
- Network summary: `evidence/network-summary.json`
- Visual report: `evidence/visual-e2e-report.md`
- Latest successful trace: `trace_f8cfe50955db4268ac`
- Latest final API result: `status=succeeded`, `image_count=1`, `http_status=200`

Privacy checks:

- No key/token stored in evidence.
- No Authorization header stored in evidence.
- No Cookie stored in evidence.
- No provider raw payload stored in evidence.
- No final prompt / compiled prompt / enhancement / fallback / callback status shown publicly.

## Newcomer Handoff

Start locally:

```bash
cd /Volumes/App_Dev/new_Prompt_prj
npm install
npm start
```

Open:

```text
http://127.0.0.1:8787/
```

Main manual test:

1. Open the ai-tu original page.
2. Choose `scene_multiview`.
3. Fill prompt: `生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图`.
4. Fill two references:
   - `ref_char`, `萧昭宁`, `character_reference`, `auxiliary`, URL present.
   - `ref_scene`, `营帐`, `scene_reference`, `primary`, URL present.
5. Click `开始生成`.
6. Confirm `POST /api/v1/image-generations` returns 200.
7. Confirm image preview is visible.
8. Confirm public page does not show internal prompt/enhancement/provider payload/key/token.

Refresh the code map:

```bash
python3 ~/.codex/skills/code-map/scripts/code_map_pipeline.py --root . --dashboard
```

## Git / Report Notes

- `.understand-anything/` contains generated local dashboard artifacts and may be ignored by git.
- `CODEGRAPH_REPORT.md` is the root-level durable handoff report.
- The ai-tu source file `ai-tu/gateway/server.js` remains a migration reference and was not modified for the final API service path.
