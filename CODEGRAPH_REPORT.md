# CodeGraph Detailed Repository Report

Date: 2026-06-09

Project root: `/Volumes/App_Dev/new_Prompt_prj`

## Verification State

CodeGraph was refreshed from the project root and used as the structural source of truth for this report.

Commands run:

```bash
codegraph sync .
codegraph files --path . --format tree --max-depth 5 --no-metadata
codegraph context "prompt optimizer task_type reference plan provider adapter route frontend tests" --path .
python3 /Users/yyq/.codex/skills/code-map/scripts/code_map_pipeline.py --root . --skip-sync --max-nodes 6000 --max-edges 20000
```

CodeGraph status after refresh:

```json
{
  "initialized": true,
  "projectPath": "/Volumes/App_Dev/new_Prompt_prj",
  "fileCount": 16,
  "nodeCount": 391,
  "edgeCount": 1049,
  "backend": "native",
  "languages": ["javascript"],
  "nodesByKind": {
    "class": 1,
    "constant": 50,
    "file": 16,
    "function": 257,
    "import": 62,
    "method": 1,
    "variable": 4
  }
}
```

Understand-Anything compatible artifacts were generated locally from CodeGraph facts under `.understand-anything/`, but those local visualization artifacts are intentionally not part of the repository commit.

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
src/storage/trace-store.js
tests/integration/provider-config.test.js
tests/unit/ai-tu-prompt-optimizer.test.js
tests/unit/image-api.test.js
```

The repository also contains PRD/spec/design documents, evidence screenshots, and the ai-tu HTML frontend. Those files are included in the human handoff below even when they are not JavaScript symbols in CodeGraph.

## Runtime Entry Points

`server.js` is the service entry point started by `npm start`.

HTTP routes:

- `GET /health`: health check.
- `GET /` and `GET /ai-image-generator.html`: serve the existing ai-tu frontend at `ai-tu/ai-image-generator.html`.
- `POST /api/prompt-optimizer`: ai-tu prompt optimization entry.
- `POST /api/v1/prompt-optimizations`: alias for the prompt optimization API.
- `POST /api/v1/image-generations`: final image generation API.
- `POST /api/image-jobs` and `GET /api/image-jobs/:id`: legacy ai-tu-compatible image job route using URL references only.

The root route deliberately serves the ai-tu original page rather than the discarded standalone console.

## Major Layers

### Frontend

`ai-tu/ai-image-generator.html` is the active browser page at `http://127.0.0.1:8787/`.

Current responsibilities:

- Preserve the original ai-tu page and generation workflow.
- Add a prompt optimization entry.
- Let the user select all 6 PRD `task_type` values.
- Collect structured `references[]` fields.
- Call `POST /api/prompt-optimizer`.
- On `status=succeeded`, overwrite the original ai-tu prompt textarea with `optimized_prompt`.
- On failed or clarification responses, keep the original prompt unchanged.
- Avoid rendering internal fields such as compiled prompt, enhancement, fallback state, provider payload, or secrets.

### Prompt Optimization Route

`src/routes/prompt-optimizations.js` implements the deterministic prompt optimizer and compiler.

Primary flow:

1. `handlePromptOptimization(body, options)`.
2. `normalizePromptOptimizationRequest`.
3. `extractEntityMentions` from `@实体名` and `[实体名]`.
4. `validateReferences`.
5. `resolvePromptOptimizationReferences`.
6. `buildReferencePlan`.
7. `callRagflowEnhancementIfAvailable`.
8. `compileOptimizedPrompt`.
9. `validateOptimizedPrompt`.
10. `buildPromptOptimizationResponse`.

Important architectural decision: RAGFlow is an optional enhancement provider, not the final prompt author. The final `optimized_prompt` is compiled by the backend Prompt Compiler from `task_type`, raw prompt, references, entity mentions, resolved references, optional validated enhancement, and deterministic quality rules.

### Final Image Generation Route

`src/routes/image-generations.js` implements `POST /api/v1/image-generations`.

Primary flow:

1. Normalize and validate API request.
2. Extract entity mentions.
3. Resolve reference binding.
4. Optionally retrieve RAGFlow enhancement through the core enhancement layer.
5. Compile the internal provider prompt.
6. Call the provider adapter.
7. Return public images, normalized mentions/references, warnings, and trace id.

The public response does not expose final prompt, compiled prompt, raw enhancement, fallback state, provider payload, provider key, or other internal data.

### Core Modules

`src/core/entity-mentions.js`

- Extracts entity mentions from `@实体名` and `[实体名]`.
- Produces stable mention ids for binding and warnings.

`src/core/reference-binding.js`

- Validates deterministic binding from request `references[]`.
- Enforces duplicate `reference_id` checks.
- Enforces primary/auxiliary clarity when the same entity and role has multiple images.
- Supports warn/block handling for unbound entity mentions.

`src/core/prompt-compiler.js`

- Compiles internal provider prompts for the final image generation API.
- Keeps internal prompt output out of public responses.

`src/core/ragflow-enhancement.js`

- Treats RAGFlow output as optional structured enhancement.
- Discards invalid, unauthorized, oversized, or internally unsafe content.

`src/core/runtime.js`, `src/core/errors.js`, and `src/core/labels.js`

- Provide schema normalization, public error mapping, forbidden-field checks, id helpers, labels, and shared constants.

`src/storage/trace-store.js`

- Stores sanitized trace metadata without provider payloads or secrets.

### Provider Adapter

`src/providers/ai-tu-provider-adapter.js` contains the migrated real-provider capability from ai-tu gateway logic.

Implemented capabilities:

- Environment/runtime-config provider configuration.
- Endpoint validation.
- API key selection without public exposure.
- Authorization bearer request construction.
- JSON text-to-image payload.
- JSON image-to-image URL payload.
- Timeout.
- Retry and retry-after handling.
- Retryable upstream error classification.
- Provider response URL extraction.
- Async job submit and poll support when upstream returns an async handle.
- Public error mapping including missing config, timeout, unsupported response, and empty image result.

Explicitly excluded:

- Multipart upload.
- imgbb upload.
- File upload.
- Base64-to-image storage.
- Local image storage.
- Serving temporary reference images.
- Any public exposure of provider payloads or keys.

## Prompt Optimizer: 6 Task Types

The optimizer supports all PRD task types and keeps `task_type` separate from `generation_mode`.

`generation_mode` rule:

- `references[]` empty: `text_to_image`.
- `references[]` non-empty: `image_to_image`.

### `text_image`

Ordinary text-to-image prompt. It improves the raw prompt into a complete image prompt with subject, composition, lighting, style, clarity, and negative constraints. It does not force professional multiview or storyboard structures.

### `image_reference`

Ordinary reference-image generation. It requires at least one reference and compiles a prompt that preserves reference visual traits while allowing a new image to be generated. Missing references returns a clarification response.

### `character_multiview`

Character four-view / character sheet compiler. It requires character multiview semantics and includes:

- 4 horizontal panels.
- Front full-body standing pose.
- Front head close-up.
- Side full-body standing pose.
- Back full-body standing pose.
- Full head-to-toe visibility.
- Visible shoes.
- A-pose stance.
- Natural hands with no held props.
- Plain background and even lighting.

### `scene_multiview`

Scene multiview / multi-camera / live-lighting compiler. It dynamically reads primary and auxiliary references from `references[]`; it does not hardcode fixture names.

It compiles:

- Main scene reference handling.
- Auxiliary reference handling by role/entity type.
- Scene as the final deliverable.
- Category-level space/layout/material/light expansion.
- Multiview board structure including panorama, medium shot, close-ups, top view, floor plan, storyboard diagram, materials, and lighting.
- Negative constraints against reference confusion and auxiliary references taking over the main scene deliverable.

### `prop_multiview`

Prop asset multiview compiler. It focuses on object structure, material, pattern, and multi-angle asset delivery:

- Overall view.
- Front, side, back views.
- Top and bottom views.
- Structural breakdown.
- Material and pattern close-ups.
- Scale reference.
- Usage-context reference.

### `storyboard`

Film storyboard compiler. It does not produce a fixed 3x3 or fixed nine-grid board. It compiles:

- Left planning area.
- Right story grid area.
- Scene blocking.
- Mood concept.
- Lighting change.
- Spatial relationship.
- Character movement.
- Camera scheduling.
- Adaptive panel count based on story stages or existing shot list.

Existing shot lists keep shot count, order, and core action while only supplementing shot size, camera movement, lighting, layout, and negative constraints.

## Reference Plan

`buildReferencePlan` returns:

- `allRefs`
- `primaryRefs`
- `auxiliaryRefs`
- `characterRefs`
- `sceneRefs`
- `propRefs`
- `styleRefs`
- `lightingRefs`
- `compositionRefs`
- `characterPrimaryRefs`
- `characterAuxiliaryRefs`
- `scenePrimaryRefs`
- `sceneAuxiliaryRefs`
- `propPrimaryRefs`
- `propAuxiliaryRefs`
- `styleAuxiliaryRefs`
- `primaryEntityNames`
- `auxiliaryEntityNames`
- `allEntityNames`
- `entityMentions`
- `resolvedReferences`
- `unboundMentions`
- `generationMode`

This is the central structure preventing hardcoded entity leakage and cross-fixture entity bleed.

## RAGFlow Enhancement Boundary

RAGFlow configuration is read from environment variables or local ai-tu runtime config files. Values are not logged in this report.

RAGFlow request behavior:

- Uses OpenAI-compatible chat completions endpoint.
- Requests JSON-like enhancement guidance, not final prompt text.
- Does not let RAGFlow decide reference binding.
- Does not let RAGFlow add reference ids or image URLs.
- Discards invalid, unsafe, unauthorized, field-summary, oversized, or internally revealing enhancement.

If RAGFlow is unavailable or returns invalid content, the backend compiler still produces the prompt from deterministic local inputs. The frontend only sees business status, warnings, trace id, and the optimized prompt when successful.

## Public API Privacy Boundary

Public responses must not include:

- `final_prompt`
- `final_prompt_preview`
- `compiled_prompt`
- `enhancement`
- RAGFlow raw output or status
- fallback state
- storyboard internal path decisions
- provider payload
- provider key
- request authentication headers
- browser session headers
- runtime config values

The test suite checks for these forbidden public fields.

## Tests and Evidence

Configured package scripts:

```bash
npm run check
npm test
```

Current visual evidence:

- `/Volumes/App_Dev/new_Prompt_prj/evidence/visual-e2e-report.md`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-text_image.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-image_reference.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-character_multiview.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-scene_multiview.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-prop_multiview.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-storyboard.png`

The visual report records that the browser opened the ai-tu original page, used `POST /api/prompt-optimizer`, and verified prompt overwrite behavior for all six task types without exposing internal prompt/compiler/provider fields.

## Newcomer Runbook

Install dependencies if needed:

```bash
npm install
```

Start service:

```bash
npm start
```

Open:

```text
http://127.0.0.1:8787/
```

Check syntax:

```bash
npm run check
```

Run unit tests:

```bash
npm test
```

Run provider config integration probe:

```bash
node tests/integration/provider-config.test.js
```

Expected provider behavior:

- Missing provider config returns `PROVIDER_CONFIG_MISSING`; it must not fake success.
- Provider responses with accessible `url`, `image_url`, or `output_url` are mapped to public image URLs.
- Provider responses containing only base64/binary data return `PROVIDER_RESPONSE_UNSUPPORTED`.

## Commit Safety Notes

The following local paths are intentionally ignored or excluded from commit:

- `.env`
- `.env.*`
- `.codegraph/`
- `.understand-anything/`
- `runtime-config.json`
- `ai-tu/runtime-config.json`
- `ai-tu/runtime-config.example.json`

Reason: they can contain local runtime state, generated indexes, browser/dashboard artifacts, or secret-like configuration values.

## High-Risk Change Areas

When changing this project, review these paths first:

- `src/routes/prompt-optimizations.js`: task type behavior, prompt compiler, quality gates, RAGFlow enhancement boundary.
- `src/core/reference-binding.js`: reference uniqueness, primary/auxiliary rules, unbound mention policy.
- `src/providers/ai-tu-provider-adapter.js`: real provider call, retry, timeout, URL response mapping, unsupported payload mapping.
- `server.js`: route exposure and ai-tu frontend serving.
- `ai-tu/ai-image-generator.html`: prompt overwrite and structured references UI.
- `tests/unit/ai-tu-prompt-optimizer.test.js`: six task type and privacy regression coverage.
- `tests/unit/image-api.test.js`: final image API schema, binding, provider response mapping, and privacy coverage.

## Summary

The repository is now structured as a root-level final image generation API service that serves the existing ai-tu frontend, adds a six-task prompt optimizer, keeps RAGFlow as optional enhancement, compiles final optimized prompts deterministically on the backend, and migrates real provider URL-based JSON generation through a scoped adapter. The committed code should preserve the privacy boundary by excluding runtime config files, local indexes, and any secret-bearing artifacts.
