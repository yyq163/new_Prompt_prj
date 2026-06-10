# Design Brief

## Experience

The browser test console is an operational verification surface, not a marketing page. It must start directly with the tool:

- task type selector
- prompt textarea
- editable references list
- reference policy selector
- output settings
- submit button
- result images and image URLs
- warnings
- request metadata

## Required Visible Flow

The user must be able to perform the visual E2E case:

1. Select `scene_multiview`.
2. Enter: `生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图。`
3. Add a structured character reference for `萧昭宁` with `reference_id`, `entity_name`, `entity_type`, `role`, and `url`.
4. Add a structured scene reference for `营帐` with `reference_id`, `entity_name`, `entity_type`, `role`, and `url`.
5. Submit and see real provider image URL or preview, plus `request_id`, `generation_id`, and `trace_id`.

## Hidden Internals

The UI must not display:

- final prompt
- compiled prompt
- enhancement
- RAGFlow status
- fallback state
- storyboard path
- provider internal payload

## Evidence

Visual evidence goes under `evidence/` and must be redacted. It may record steps, screenshot path, HTTP status, whether image URLs returned, trace ID, and forbidden-field absence checks.
