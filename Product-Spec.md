# Product Spec

## Product

Final prompt-optimized image generation API service for `/Volumes/App_Dev/new_Prompt_prj`.

## Goal

Expose a production API and visible test console that accept JSON image generation requests, bind prompt entity mentions to user-supplied reference image URLs, compile an internal backend-only prompt, optionally consume structured RAGFlow enhancement, and call a real upstream provider through provider logic migrated from `ai-tu/gateway/server.js`.

## Source Of Truth

- SPEC: `docs/spec/final_image_generation_api_spec_codex_autonomous_v1_4.md`
- Provider migration source, read-only: `ai-tu/gateway/server.js`

If this document conflicts with the SPEC, the SPEC wins except for the explicit path and safety corrections from the active task.

## User Outcomes

- API clients call `POST /api/v1/image-generations` with `prompt`, `task_type`, `references[]`, `reference_policy`, `output`, and `options`.
- Users can exercise the same flow from a browser test console.
- Successful responses return standardized `images[]`, `request_id`, `generation_id`, `trace_id`, normalized public binding data, and warnings.
- Responses never expose internal prompt text, RAGFlow raw output, fallback state, provider payloads, keys, cookies, or authorization headers.

## Supported Task Types

- `text_image`
- `image_reference`
- `character_multiview`
- `scene_multiview`
- `prop_multiview`
- `storyboard`

Task type is selected by requested deliverable, not inferred from whether a character, scene, or prop appears in the prompt.

## Non Goals

- No callback implementation.
- No file upload, multipart parsing, image hosting, binary image storage, base64-to-URL conversion, or temporary file transfer.
- No runtime import or require of `ai-tu/gateway/server.js`.
- No mock provider success for business acceptance.
- No modification under `ai-tu/**`.
