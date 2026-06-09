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
- `task_type` must be one of the supported task types.
- `text_image` must not include references.
- `image_reference`, `character_multiview`, `scene_multiview`, and `prop_multiview` require references.
- `callback_url` is rejected as `CALLBACK_NOT_IMPLEMENTED`.
- Duplicate `reference_id` is rejected.
- Duplicate `entity_name + role` without explicit `usage` is rejected.
- Multiple primary references for the same `entity_name + role` are rejected.

## Provider

The adapter reads environment config, validates endpoints, rotates keys, constructs Authorization Bearer headers, sends JSON text-to-image or image-to-image URL payloads, retries retryable upstream errors, honors `Retry-After`, extracts image URLs, and maps unsupported base64/binary-only results to `PROVIDER_RESPONSE_UNSUPPORTED`.

## RAGFlow

RAGFlow is optional. Invalid, unsafe, oversized, prompt-leaking, or reference-overriding enhancement is discarded silently for public callers.
