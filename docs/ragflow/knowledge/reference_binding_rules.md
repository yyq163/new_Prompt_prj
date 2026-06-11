# Reference Binding Rules

## title

Structured reference binding project rules

## applicable_task_type

`image_reference`, `character_multiview`, `scene_multiview`, `prop_multiview`,
`storyboard`

## purpose

Keep RAGFlow enhancement aligned with the Final Image Generation API reference
contract. RAGFlow may describe how existing references should influence a prompt,
but it must not create references, URLs, weights, or binding decisions.

## input_signals

- Input contains `entity_mentions`.
- Input contains `resolved_references`.
- The user prompt references entities with `@name` or bracket markers.
- The task type allows image references.

## output_fields

- `visual_focus`
- `composition_notes`
- `negative_notes`
- `missing_constraints`

## template_rules

- Use only reference entities present in `resolved_references`.
- Use existing role semantics: character, face, outfit, hair, scene, prop,
  material, ornament, style, composition, lighting, and storyboard references.
- If reference metadata is insufficient for a requested template, use
  `missing_constraints`.
- Keep binding language descriptive. The backend remains responsible for
  deterministic binding and provider URL input.

## negative_constraints

- Do not output new `reference_id` values.
- Do not output or rewrite URLs.
- Do not assign primary/auxiliary roles, weights, or priority.
- Do not mention URL-only references or empty global references as supported.
- Do not output callback state, provider state, fallback state, final prompt, or
  compiled prompt.

## disabled_when

- The task is `text_image`, because references are not allowed.
- `resolved_references` is empty and the user prompt has no supported reference
  binding requirement.

## source_mode

`project_business_template_seed`

## derived_from

Final Image Generation API V1.4 contract and project product discussion.

## notes

This seed is a contract boundary document, not a provider capability claim.
