# Frontend Design

## Test Console Layout

The first viewport is the tool itself:

- left column: generation request form
- right column: response status, metadata, warnings, and images

## Controls

- Select menu for `task_type`.
- Textarea for prompt.
- Repeating reference editor rows.
- Select controls for `entity_type`, `role`, and `usage`.
- Select for `reference_policy.unbound_entity`.
- Inputs for count and aspect ratio.
- Submit button.

## Display Rules

Display only public response fields:

- request ID
- generation ID
- trace ID
- status
- warnings
- image URLs
- image previews

Never display internal prompt, compiled prompt, enhancement, RAGFlow status, fallback state, storyboard path, provider payload, authorization, cookie, or key.
