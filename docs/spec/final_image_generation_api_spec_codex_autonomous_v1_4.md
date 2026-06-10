# Final Image Generation API Spec

Current effective date: 2026-06-10

This file is the current effective contract for the repository-local final image generation API service.

## Scope

The service receives downstream JSON requests, validates structured references, extracts entity mentions, binds real reference image URLs, compiles an internal provider prompt, calls the real upstream provider, normalizes provider image results, and returns public `images[].url`.

## Endpoints

- `POST /api/v1/image-generations`
- `GET /api/v1/generated-images/:image_id`

The ai-tu frontend at `/` is the visible test page. The legacy `/api/image-jobs` route is not the final API acceptance route.

## Request

Required:

- `task_type`
- `prompt`

Optional:

- `request_id`
- `references[]`
- `reference_policy`
- `output`
- `options`
- `callback_url`
- `callback.url`

## task_type

- `text_image`
- `image_reference`
- `character_multiview`
- `scene_multiview`
- `prop_multiview`
- `storyboard`

`task_type` describes the final deliverable. `generation_mode` is derived from references:

- no references: `text_to_image`
- one or more references: `image_to_image`

## references[]

References are strict structured objects. The service does not support URL-only references, empty-entity global references, or a generic catch-all role.

Required fields:

- `reference_id`: required and unique within one request
- `entity_name`: required
- `entity_type`: required enum
- `role`: required enum
- `url`: required HTTP(S) URL

Optional fields:

- `mime_type`
- `display_name`
- `description`
- `order`
- `usage`: accepted from old clients but ignored by current logic and not returned

Allowed `entity_type` values:

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

Allowed `role` values:

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

Compatibility alias:

- `pattern_reference` maps to `ornament_reference`

## Reference Binding

- Prompt mentions use `@实体名` or `[实体名]`.
- Binding is by exact `entity_name`.
- A mention can bind to multiple reference IDs.
- Multiple references with the same `entity_name + role` are allowed and all are used.
- References not explicitly mentioned in the prompt are still included in `references_used`, Prompt Compiler context, and provider URL input.
- There is no current reference weighting or role-required priority concept.

Task rules:

- `text_image`: references are forbidden.
- `image_reference`: at least one reference is required.
- `character_multiview`: references are optional; missing face/character reference may produce a warning.
- `scene_multiview`: references are optional; missing scene reference may produce a warning.
- `prop_multiview`: references are optional; missing prop/material/ornament reference may produce a warning.
- `storyboard`: references are optional.

## output

- `count`: integer 1-4
- `aspect_ratio`: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`
- `quality`: `standard`, `high`
- `return_format`: `url`
- `language`: `zh-CN`

## Callback

`callback_url` and `callback.url` are accepted and validated as HTTP(S), but callbacks are not executed in this version. No callback task is created and no callback status is returned.

## Prompt Compiler and RAGFlow

The backend Prompt Compiler owns the internal provider prompt. RAGFlow or other LLM output is optional structured enhancement only.

Discard enhancement when it is unavailable, invalid, unsafe, oversized, leaks internal prompt fields, references unknown IDs, or introduces unknown URLs. Public responses must not expose enhancement, RAGFlow state, fallback state, or internal prompts.

## Provider Result Normalization

Provider result forms supported:

- external image URL
- `b64_json`
- `base64`
- data URL
- binary buffer / ArrayBuffer / typed array
- direct binary HTTP image response

The final API always returns `images[].url`.

If the provider returns external URLs, they are returned as public image URLs. If the provider returns real image bytes, the bytes are stored in Generated Image Store and exposed through `/api/v1/generated-images/:image_id`.

Generated Image Store requirements:

- random non-enumerable image IDs
- TTL
- cleanup
- maximum object count
- maximum image byte size
- MIME whitelist: `image/png`, `image/jpeg`, `image/webp`
- magic-byte validation
- expired or missing images return 404
- image route returns `Content-Type`, `Content-Length`, and `Cache-Control: no-store`
- no raw provider payload or raw base64 is returned

## Forbidden

- mock provider success
- fake image URL
- placeholder image as success
- reference image upload
- multipart upload
- image hosting upload
- runtime import of `ai-tu/gateway/server.js`
- public internal prompt fields
- public provider payload
- public raw generated-image bytes or base64
- secret values in docs, evidence, traces, or logs

## Concurrency Status

This phase does not claim industrial high-concurrency completion. Current status is documented in `docs/concurrency-status.md`.
