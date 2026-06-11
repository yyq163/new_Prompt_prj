# Backend Design

## API

`POST /api/v1/image-generations` accepts JSON and returns a public `ImageGenerationResponse`.

## Core Types

- `ImageGenerationRequest`
- `ImageGenerationResponse`
- `ReferenceInput`
- `EntityMention`
- `ResolvedReference`
- `ReferencePolicy`
- `GenerationImage`
- `ProviderAdapterResult`
- `RagflowEnhancement`

## Validation

- `prompt` is required.
- `task_type` must be one of the six supported task types.
- `reference_id` is required and unique within one request.
- `entity_name` is required for every reference.
- `entity_type` is required and must be one of the strict enum values.
- `role` is required and must be one of the strict enum values.
- `pattern_reference` is accepted only as an alias for `ornament_reference`.
- `references[].url` is required and must be an HTTP(S) URL.
- URL-only references are not supported.
- Empty-entity global references are not supported.
- `text_image` rejects references with `REFERENCES_NOT_ALLOWED`.
- `image_reference` requires at least one reference with `REFERENCE_REQUIRED`.
- `character_multiview`, `scene_multiview`, `prop_multiview`, and `storyboard` can run with or without references. Missing task-specific reference types produce warnings, not blockers.
- `usage` is accepted from old clients but ignored; it does not affect weighting, ordering, or validation.
- Multiple references with the same `entity_name + role` are allowed and all are used.
- `callback_url` and `callback.url` are accepted and validated as public HTTP(S) URLs but not executed.
- Callback URL validation rejects localhost, loopback, link-local, private network ranges, IPv6 local/private ranges, and non-HTTP(S) schemes by default.

## Reference Binding

- Prompt mentions are extracted from `@实体名` and `[实体名]`.
- Mention binding is deterministic by `entity_name`.
- One mention can bind to multiple reference IDs.
- References not mentioned in the prompt are still kept in `references_used`, Prompt Compiler context, and provider URL input.
- The response does not expose reference URLs or ignored compatibility fields.

## Provider

The adapter reads environment/runtime config, validates endpoints, rotates keys, constructs bearer-auth JSON requests, sends text-to-image or image-to-image URL payloads, handles timeout/retry/polling, and maps provider failures to public error codes.

Provider results are normalized by `src/providers/provider-result-normalizer.js`.

Supported result forms:

- external image URL
- `b64_json`
- `base64`
- `data:image/...`
- binary `Buffer`, `ArrayBuffer`, or typed array
- direct binary HTTP image response

The public API always returns `images[].url`. Real provider bytes are stored in Generated Image Store and exposed through `/api/v1/generated-images/:image_id`.

`PUBLIC_BASE_URL` is the production base for service-generated image URLs. It must be HTTP(S), is normalized without trailing slash, and is required in production before returning `/api/v1/generated-images/:image_id` URLs. Local development can fall back to the local host and port.

## Generated Image Store

The in-memory default store is only for real provider generated-image bytes. It is not a reference upload store.

- random image IDs
- TTL
- cleanup
- maximum object count
- maximum image bytes
- MIME whitelist: `image/png`, `image/jpeg`, `image/webp`
- magic-byte MIME validation
- expired or missing images return 404
- image route returns correct `Content-Type`, `Content-Length`, and `Cache-Control: no-store`

## Legacy Route

`/api/image-jobs` is deprecated and compatibility-only. It sends deprecation headers and cannot be used as a Final API V1.4 acceptance endpoint or as a structured-reference bypass.

## RAGFlow

RAGFlow is optional. It can provide structured enhancement only. Invalid, unsafe, oversized, prompt-leaking, unknown-reference, or unknown-URL enhancement is discarded for public callers. The backend Prompt Compiler remains the final prompt owner.

Professional templates are no longer unconditional compiler behavior. Character
four-view, scene 3x3 or multi-camera, prop multi-angle/detail, and storyboard
layout details belong in RAGFlow knowledge seed documents under
`docs/ragflow/knowledge/`. The RAGFlow system prompt in
`docs/ragflow/ragflow_system_prompt_knowledge_driven_v1.md` only defines JSON
protocol and anti-hallucination boundaries.

The Prompt Compiler fallback keeps only:

- task type and original user prompt
- deterministic reference binding text
- output description
- minimal task safety notes
- common negative rules

When validated enhancement exists, the compiler appends supported fields:
`scene_summary`, `visual_focus`, `story_function`, `action_stages`,
`shot_plan`, `normalized_shot_plan`, `lighting_notes`, `composition_notes`,
`negative_notes`, and `missing_constraints`.

Storyboard internal paths remain:

- `fallback_generic_storyboard_minimal`
- `normalized_existing_shots`
- `preserve_full_prompt`
- `script_to_storyboard`

These paths are backend-only and are not returned in public responses.

## Concurrency

The current service has ordinary Node HTTP concurrency, provider timeout/retry/polling basics, and bounded in-memory generated-image storage. It does not claim industrial high-concurrency readiness. Queueing, backpressure, global provider semaphores, per-key concurrency limits, persisted task state, cancellation, and durable resume are not implemented in this phase.
