# Prop Multiview Template

## title

Prop multiview project template seed

## applicable_task_type

`prop_multiview`

## purpose

Provide optional project-specific composition guidance for prop asset reference
boards when the user asks for a prop multiview, material, ornament, or usage
reference.

## input_signals

- User asks for prop multiview, prop asset sheet, object turn-around, material
  detail, ornament detail, use-state, or scale relationship.
- Bound references include `prop_reference`, `material_reference`,
  `ornament_reference`, `style_reference`, or scene/character references that
  define use context.
- The prompt asks to preserve structure, silhouette, material, pattern, or scale.

## output_fields

- `visual_focus`
- `composition_notes`
- `lighting_notes`
- `negative_notes`
- `missing_constraints`

## template_rules

- Optional prop asset board when explicitly applicable.
- Supported views may include front, side, back, top, bottom structure, material
  close-up, ornament close-up, use-state image, and scale relationship when the
  user prompt or retrieved knowledge calls for them.
- Preserve the same object identity, silhouette, functional parts, material
  finish, color, ornament, wear level, and scale cues across all panels.
- Use scene or character references only for context and scale unless the user
  asks for an in-scene usage render.

## negative_constraints

- Do not add front/side/back, top/bottom, material close-up, ornament close-up,
  use-state, or scale diagram unless supported by prompt or retrieved knowledge.
- Do not mix material and ornament references across unrelated objects.
- Do not add text labels, watermarks, or UI frames.
- Do not transform a prop sheet into a character or scene reference board.

## disabled_when

- The user asks for one hero image of the object rather than a production
  reference board.
- The retrieved knowledge is absent or unrelated to prop design.
- The user-specified composition conflicts with a fixed asset-board structure.

## source_mode

`project_business_template_seed`

## derived_from

Project product discussion for the Final Image Generation API RAGFlow knowledge
enhancement workflow.

## notes

The backend does not hardcode these views. They must arrive through validated
RAGFlow JSON enhancement or direct user prompt content.
