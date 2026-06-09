# API Contracts

## POST /api/v1/image-generations

### Request

Required:

- `task_type`
- `prompt`

Optional:

- `request_id`
- `references[]`
- `reference_policy`
- `output`
- `options`

### references[]

- `reference_id`
- `entity_name`
- `entity_type`
- `role`
- `usage`
- `url`
- `mime_type`
- `display_name`
- `description`
- `order`

### Response

Public response fields:

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
- `error_code`
- `message`

Forbidden response fields:

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

## Error Codes

- `INVALID_REQUEST_SCHEMA`
- `DUPLICATE_REFERENCE_ID`
- `DUPLICATE_ENTITY_ROLE_REFERENCE`
- `MULTIPLE_PRIMARY_REFERENCES`
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
- `CALLBACK_NOT_IMPLEMENTED`
