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
- `callback_url` and `callback.url` are accepted and validated but not executed.

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

## RAGFlow

RAGFlow is optional. It can provide structured enhancement only. Invalid, unsafe, oversized, prompt-leaking, unknown-reference, or unknown-URL enhancement is discarded for public callers. The backend Prompt Compiler remains the final prompt owner.

## Concurrency

The current service has ordinary Node HTTP concurrency, provider timeout/retry/polling basics, and bounded in-memory generated-image storage. It does not claim industrial high-concurrency readiness. Queueing, backpressure, global provider semaphores, per-key concurrency limits, persisted task state, cancellation, and durable resume are not implemented in this phase.
