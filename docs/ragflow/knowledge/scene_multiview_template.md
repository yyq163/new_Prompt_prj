# Scene Multiview Template

## title

Scene multiview project template seed

## applicable_task_type

`scene_multiview`

## purpose

Provide optional project-specific composition guidance for scene space reference
boards when the user asks for a scene multiview or spatial planning output.

## input_signals

- User asks for scene multiview, scene reference board, spatial design, lighting
  planning, multi-camera reference, or environment production reference.
- Bound references include `scene_reference`, `lighting_reference`,
  `composition_reference`, `style_reference`, character references, or prop
  references that should be placed in the scene.
- The prompt asks to clarify entrance, depth, occlusion, staging, or light
  source relationships.

## output_fields

- `scene_summary`
- `visual_focus`
- `composition_notes`
- `lighting_notes`
- `negative_notes`
- `missing_constraints`

## template_rules

- Optional 3x3 or multi-panel scene reference board when explicitly applicable.
- Represent the overall scene identity, spatial structure, entrance/depth,
  occlusion layers, main light source, secondary light, and practical shooting
  positions when these are supported by user input or retrieved knowledge.
- Optional panels may include wide establishing view, mid-view staging, close-up
  detail, overhead or floor-plan-like spatial cue, and lighting/composition
  notes when requested or retrieved.
- Use all bound references according to their roles. Character, prop, style,
  lighting, and composition references should not overwrite the scene identity.

## negative_constraints

- Do not claim a floor plan, top view, multi-camera grid, or 3x3 board unless
  the prompt or retrieved knowledge supports it.
- Do not merge unrelated reference entities.
- Do not introduce text labels, watermarks, or schematic UI unless requested.
- Do not turn scene references into character sheets or prop sheets.

## disabled_when

- The user asks for a single final scene illustration rather than a reference
  planning board.
- The retrieved knowledge is absent or unrelated to scene layout.
- A fixed grid would conflict with the requested aspect ratio, composition, or
  output count.

## source_mode

`project_business_template_seed`

## derived_from

Project product discussion for the Final Image Generation API RAGFlow knowledge
enhancement workflow.

## notes

This document records optional business template knowledge. RAGFlow should output
these rules only as JSON enhancement when the knowledge is retrieved and
applicable.
