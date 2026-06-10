# API Contracts

## POST /api/v1/image-generations

Final image generation API. The request body is JSON only.

### Request Fields

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

### task_type

Allowed values:

- `text_image`
- `image_reference`
- `character_multiview`
- `scene_multiview`
- `prop_multiview`
- `storyboard`

### references[]

`references[]` remains a strict structured list. URL-only references are not supported.

Required for every reference:

- `reference_id`: required, unique within one request
- `entity_name`: required
- `entity_type`: required enum
- `role`: required enum
- `url`: required HTTP(S) URL

Optional metadata:

- `mime_type`
- `display_name`
- `description`
- `order`
- `usage`: accepted for old clients, ignored by current business logic, never returned

There is no global reference mode and no empty `entity_name` mode. Every reference must name the entity it describes.

Multiple references with the same `entity_name + role` are allowed and all are used. The service does not apply reference weighting. References not explicitly mentioned in the prompt still enter `normalized.references_used`, Prompt Compiler context, and provider URL input.

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

Reference task rules:

- `text_image`: `references[]` must be empty, otherwise `REFERENCES_NOT_ALLOWED`.
- `image_reference`: at least one reference is required, otherwise `REFERENCE_REQUIRED`.
- `character_multiview`, `scene_multiview`, `prop_multiview`, `storyboard`: references may be empty or non-empty. Missing task-specific reference types may produce warnings but do not block the request.

### output

- `count`: integer, 1-4
- `aspect_ratio`: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`
- `quality`: `standard`, `high`
- `return_format`: `url`
- `language`: `zh-CN`

### callback

`callback_url` and `callback.url` are accepted and validated as public HTTP(S) URLs, but this version does not execute callbacks, create callback jobs, or return callback status. Callback URL validation defaults to rejecting localhost, loopback, link-local, private network ranges, IPv6 local/private ranges, and non-HTTP(S) schemes.

### Generated image public URL

Generated Image Store URLs are built from `PUBLIC_BASE_URL` when configured. The value must be HTTP(S); trailing slashes are removed before appending `/api/v1/generated-images/:image_id`.

In production, `PUBLIC_BASE_URL` is required for service-generated image URLs. Local development may fall back to the current local host and port.

### Legacy route

`/api/image-jobs` is a deprecated compatibility route for old page/client behavior. It sends deprecation headers and is not a Final API V1.4 acceptance endpoint. It must not be used to bypass the structured `references[]` contract.

### Response

Public success fields:

- `request_id`
- `generation_id`
- `status`
- `task_type`
- `task_type_label`
- `generation_mode`
- `input`
- `images`
- `normalized`
- `warnings`
- `trace_id`

`images[]` always returns URLs. Provider URL results are returned directly. Provider base64, data URL, or binary image results are stored as temporary generated-image URLs under `/api/v1/generated-images/:image_id`.

`normalized.references_used[]` returns:

- `reference_id`
- `entity_name`
- `entity_type`
- `role`
- `role_label`
- `display_name`
- `order`

It does not return `url` or `usage`.

Forbidden public fields:

- `final_prompt`
- `final_prompt_preview`
- `compiled_prompt`
- `enhancement`
- `input_analysis`
- `storyboard_processing`
- `storyboard_path`
- `provider_internal_payload`
- RAGFlow status
- fallback state
- callback status
- raw provider payload
- raw base64 or binary image content

## Error Codes

- `INVALID_REQUEST_SCHEMA`
- `DUPLICATE_REFERENCE_ID`
- `INVALID_REFERENCE_ROLE`
- `REFERENCES_NOT_ALLOWED`
- `REFERENCE_REQUIRED`
- `ENTITY_REFERENCE_NOT_FOUND`
- `PROMPT_REQUIRED`
- `UNSUPPORTED_TASK_TYPE`
- `PROVIDER_CONFIG_MISSING`
- `IMAGE_PROVIDER_CALL_FAILED`
- `IMAGE_PROVIDER_TIMEOUT`
- `IMAGE_RESULT_EMPTY`
- `PROVIDER_RESPONSE_UNSUPPORTED`
- `IMAGE_NOT_FOUND`
