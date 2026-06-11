# Character Multiview Template

## title

Character multiview project template seed

## applicable_task_type

`character_multiview`

## purpose

Provide optional project-specific composition guidance for character design
reference sheets when the user asks for a character multiview output or when the
retrieved context clearly indicates this template should apply.

## input_signals

- User asks for character multiview, four-view, turn-around, character sheet, or
  consistent character design reference.
- Bound references include `character_reference`, `face_reference`,
  `outfit_reference`, or `hair_reference`.
- The prompt asks to preserve identity, costume, hair, silhouette, or body
  proportions across views.

## output_fields

- `visual_focus`
- `composition_notes`
- `lighting_notes`
- `negative_notes`
- `missing_constraints`

## template_rules

- Optional four-view horizontal character reference board when explicitly
  applicable: full-body front view, one front head detail, full-body side view,
  and full-body back view.
- Keep the same identity, face structure, hairstyle, outfit silhouette, colors,
  material cues, body proportions, and footwear across all views.
- Use a stable neutral standing pose only when the user or retrieved knowledge
  asks for a clean design sheet. Do not add weapons or handheld props unless
  requested.
- Keep background simple when the user asks for a design reference sheet.

## negative_constraints

- Do not add multiple unrelated character identities.
- Do not mix clothing, face, hair, or role references across entities.
- Do not add text labels, watermarks, signature marks, or UI frames.
- Do not crop essential full-body information when full-body consistency is
  required by the user or retrieved knowledge.

## disabled_when

- The user asks for a single portrait, action illustration, poster, or cinematic
  scene rather than a design reference.
- No character template knowledge is retrieved and the user prompt does not ask
  for multiview or four-view structure.
- Applying a fixed four-view sheet would contradict user-specified layout,
  aspect ratio, or scene action.

## source_mode

`project_business_template_seed`

## derived_from

Project product discussion for the Final Image Generation API RAGFlow knowledge
enhancement workflow.

## notes

This document may be ingested into RAGFlow. The system prompt must not reproduce
these rules by default; it should only output them when retrieval and the user
input support them.
