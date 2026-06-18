# API Contracts

## POST /api/v1/image-generations

Final image generation API. The request body is JSON only.

Malformed JSON and request bodies over `MAX_BODY_SIZE` return HTTP 400 with
the V3.6 failure envelope (`status: "failed"`, `error.code:
"INVALID_REQUEST_SCHEMA"`) before request normalization or provider execution.
Client validation errors retain their original public `error.code` and 4xx
status. Direct Final API clarification responses currently keep
`status: "needs_clarification"` with HTTP 200; the standalone `ai-tu/gateway`
proxy normalizes that specific status to HTTP 400. Only provider/upstream
failures are mapped to generic prompt image backend error codes.

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

Browser gateway rule:

- The `ai-tu` product gateway is stricter than the root Final API compatibility
  layer. It requires at least one valid absolute http(s) reference for every
  non-`text_image` browser submission before forwarding to the backend. This
  prevents unbound image-mode submissions from the product page while preserving
  the root Final API's warning-compatible behavior for direct API callers.

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

### Provider routing and model

The Final API provider model is fixed to `gpt-image-2`. Runtime configuration
must not change the model and must not fall back to `gpt-image-2-all`,
`gpt-image-1`, `dall-e-*`, or any other model.

Provider payload selection is derived from reference presence and the configured
transport:

- No references / `text_to_image`: `POST /v1/images/generations`, `model: "gpt-image-2"`
- With references / URL transport: use the configured generation endpoint from
  the active ToAPIs runtime config and send structured reference URLs as
  `reference_images`.
- With references / multipart edit transport: use the configured edit endpoint
  and send structured reference images as provider file parts.

`task_type` must not change the model. The current ToAPIs runtime config is the
source of truth for URL-transport reference endpoint selection. Provider failure
is returned as failure; this API must not mock success.

## POST /api/reference-images

Browser helper endpoint for local UI acceptance. It accepts one multipart
`image` file and, under the current authoritative `真实配置_toapis.md`,
prefers uploading that file to the configured public image host before
returning the structured `references[].url`. Only when no public image host is
enabled does it fall back to an in-memory Generated Image Store URL.

This endpoint is not the Final image generation API and does not allow
URL-only generation requests. `POST /api/v1/image-generations` remains JSON
only and still requires structured `references[]`.

Only service-generated local image URLs under
`/api/v1/generated-images/img_*` are allowed back into `references[].url` for
this browser upload flow. Other localhost, loopback, link-local, or private
reference URLs remain rejected unless an explicit development override is set.

### RAGFlow knowledge enhancement

RAGFlow is optional and may provide only a validated JSON enhancement object for
the backend Prompt Compiler. It does not produce the public response, provider
payload, final provider prompt, reference binding, image URLs, or callback
state.

The Prompt Compiler local fallback is intentionally minimal. Without a valid
enhancement or explicit user prompt content, it must not inject full
professional templates such as character four-view sheets, scene 3x3 or
multi-camera boards, prop front/side/back or material-detail boards, or
storyboard left/right planning layouts.

The prompt optimizer first applies a global safe-field allowlist, then applies a
task-specific consumed-field allowlist. If an enhancement contains any field
that the current `task_type` does not consume, the whole enhancement is
discarded and deterministic fallback is used.

Global safe enhancement fields:

- `scene_summary`
- `visual_focus`
- `story_function`
- `action_stages`
- `shot_plan`
- `normalized_shot_plan`
- `lighting_notes`
- `composition_notes`
- `negative_notes`
- `missing_constraints`

Task-specific consumed fields:

- `text_image`: `visual_focus`, `lighting_notes`, `composition_notes`,
  `missing_constraints`
- `image_reference`: `visual_focus`, `lighting_notes`, `composition_notes`,
  `missing_constraints`
- `character_multiview`: `visual_focus`, `composition_notes`,
  `missing_constraints`
- `scene_multiview`: `scene_summary`, `visual_focus`, `lighting_notes`,
  `composition_notes`, `missing_constraints`
- `prop_multiview`: `visual_focus`, `composition_notes`, `missing_constraints`
- `storyboard`: `story_function`, `action_stages`, `lighting_notes`,
  `composition_notes`, `missing_constraints`

The API discards unsafe enhancement when it leaks `final_prompt` or
`compiled_prompt`, emits any `reference_id` / `reference_ids`, emits any URL,
uses fields outside the prompt optimizer allowlist, returns a non-object or
non-JSON value, carries primary / auxiliary / weight / priority binding
semantics, emits credentials, base64, data URLs, provider payloads, callback
state, unknown `asset_id`, or places internal implementation language in any
enhancement field.

RAGFlow URL configuration is server-side only. `RAGFLOW_BASE_URL`,
`RAGFLOW_CHAT_ID`, `RAGFLOW_API_KEY`, optional `RAGFLOW_MODEL`, and resource
limits such as `RAGFLOW_TIMEOUT_MS`, `RAGFLOW_DNS_TIMEOUT_MS`,
`RAGFLOW_MAX_REQUEST_BYTES`, `RAGFLOW_MAX_REQUEST_MESSAGE_CHARS`,
`RAGFLOW_MAX_RESPONSE_BYTES`, `RAGFLOW_MAX_JSON_DEPTH`,
`RAGFLOW_MAX_JSON_KEYS`, `RAGFLOW_MAX_JSON_ARRAY_LENGTH`,
`RAGFLOW_MAX_JSON_STRING_LENGTH`, and `RAGFLOW_MAX_ENHANCEMENT_CHARS` are never
accepted from user request payloads.
`RAGFLOW_DEPLOYMENT_TIER` is strict and must be one of `production`,
`staging`, `development`, or `test`; missing values and aliases such as `prod`,
`stage`, `qa`, or unknown tiers are configuration errors. Production and staging
require HTTPS plus an explicit `RAGFLOW_ALLOWED_ORIGINS` entry that exactly
matches scheme, host, and effective port, and they always reject private
endpoints even when `RAGFLOW_ALLOW_PRIVATE_ENDPOINTS=true`. Development and test
reject private endpoints by default and allow only loopback, RFC1918, or ULA
private endpoints with `RAGFLOW_ALLOW_PRIVATE_ENDPOINTS=true`. Metadata,
link-local, multicast, reserved, and documentation ranges remain blocked even
with the opt-in. Malformed allowlist entries are configuration errors.

### Prompt optimization response

`POST /api/v1/prompt-optimizations` uses an independent request schema:

- `request_id`
- `task_type`
- `prompt`
- `references`
- `reference_policy`

Unknown request fields are rejected. The optimizer does not accept `output`,
`options`, callback fields, provider/model fields, credentials, image payloads,
base64, raw provider payloads, `final_prompt`, `compiled_prompt`, or
`internal_prompt`. Its `references[]` sub-schema is narrower than
`POST /api/v1/image-generations`: it accepts only `reference_id`, `entity_name`,
`entity_type`, `role`, `url`, `mime_type`, `display_name`, `description`, and
`order`; legacy `usage` is rejected for prompt optimization requests.

The prompt optimization request validator is recursive. Every object level is
treated as `additionalProperties=false`, and field names must be exact ASCII
contract keys. Field names are also normalized with NFKC, trim, lowercase, and
separator removal before duplicate/conflict checks. Duplicate JSON keys,
canonical conflicts, `__proto__`, `prototype`, `constructor`, and snake/camel/
kebab/fullwidth variants of forbidden keys are rejected even when their value is
`null`, `false`, `0`, or an empty string. Outbound RAGFlow payloads are rebuilt
only from the normalized allowlist and never spread or forward the raw body.

Natural-language values may discuss security terms such as `Authorization`,
`Bearer token`, `cookie`, `secret`, `base64`, `final_prompt`, provider payloads,
`b64_json`, or `data_url` when they are ordinary teaching or design text. The
validator rejects only structured forbidden fields or high-confidence payloads:
real `Authorization` / `Proxy-Authorization` credentials with any scheme,
quoted credential assignments, API tokens/secrets/passwords, Cookie/Set-Cookie
values, data URIs, verifiable long base64, known key prefixes, and high-entropy
credential-like values. Rejected values are not sent to RAGFlow and are not
echoed in public errors.

Prompt optimization has independent input bounds for prompt Unicode characters
and UTF-8 bytes, single reference text, references aggregate text, JSON depth,
key count, array length, and string length. RAGFlow request JSON has separate
message-character and byte limits. Values exactly at their configured limit are
accepted; values one unit over are rejected with `INVALID_REQUEST_SCHEMA` before
RAGFlow lookup or fetch.

Public success fields:

- `status`
- `request_id`
- `optimization_id`
- `task_type`
- `task_type_label`
- `generation_mode`
- `optimized_prompt`
- `normalized`
- `warnings`
- `trace_id`

Public error fields:

- `status`
- `request_id`
- `error_code`
- `message`
- `trace_id`

Prompt optimization responses never expose RAGFlow raw output/status, fallback
status, internal prompt, enhancement object, provider details, callback state,
image URLs, base64, secrets, or stack traces.

### Legacy route

`/api/image-jobs` is a deprecated compatibility route for old page/client behavior. `POST /api/image-jobs` and `GET /api/image-jobs/:id` return `410 LEGACY_IMAGE_JOBS_DISABLED`, send deprecation headers, and never create or read a provider job. It is not a Final API V1.4 acceptance endpoint and cannot bypass the structured `references[]` contract.

### Response

Public success fields:

- `status`
- `images`
- `warnings`

`images[]` always returns URLs. Provider URL results are validated before being returned. Provider base64, data URL, or binary/direct image results are stored as temporary generated-image URLs under `/api/v1/generated-images/:image_id`.

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
- `OPTIMIZED_PROMPT_INVALID`
- `PROVIDER_CONFIG_MISSING`
- `IMAGE_PROVIDER_CALL_FAILED`
- `IMAGE_PROVIDER_TIMEOUT`
- `IMAGE_RESULT_EMPTY`
- `PROVIDER_RESPONSE_UNSUPPORTED`
- `IMAGE_NOT_FOUND`
