# Storyboard Template

## title

Storyboard project template seed

## applicable_task_type

`storyboard`

## purpose

Provide optional project-specific storyboard composition and processing guidance
when the user asks for a storyboard, shot plan, script-to-shot conversion, or a
complete storyboard board.

## input_signals

- User provides a script, scene paragraph, shot list, or complete storyboard
  prompt.
- User asks for story function, action stages, shot plan, or visual continuity.
- Bound references include `storyboard_reference`, `character_reference`,
  `scene_reference`, `prop_reference`, `lighting_reference`, or
  `composition_reference`.

## output_fields

- `scene_summary`
- `story_function`
- `action_stages`
- `shot_plan`
- `normalized_shot_plan`
- `lighting_notes`
- `composition_notes`
- `negative_notes`
- `storyboard_processing`
- `missing_constraints`

## template_rules

- For an existing explicit shot list, set
  `storyboard_processing: "normalize_shot_list"` and return
  `normalized_shot_plan` while preserving the original shot count and order.
- For a complete user-authored storyboard prompt, set
  `storyboard_processing: "preserve_full_prompt"` and use
  `missing_constraints` or notes only for constraints that are absent.
- For script-to-storyboard conversion, set
  `storyboard_processing: "script_to_storyboard"` and return a supported
  `shot_plan` only when user input or retrieved knowledge gives enough story
  content.
- Optional production board layout may include a planning area and story panels
  only when the user asks for it or this knowledge is retrieved as applicable.
- Do not default to a fixed shot count, fixed total duration, nine-grid,
  four-grid, 2x2, or 3x3 layout.

## negative_constraints

- Do not reorder user-provided shots during normalization.
- Do not invent missing plot beats, characters, props, scene changes, or camera
  moves.
- Do not add text labels, watermarks, or UI frames.
- Do not expose internal compiler path names, fallback status, or provider
  payload details.

## disabled_when

- The user asks for a single illustration rather than storyboard output.
- The prompt lacks enough story content and no storyboard knowledge is retrieved.
- A fixed board layout would conflict with the user prompt.

## source_mode

`project_business_template_seed`

## derived_from

Project product discussion for the Final Image Generation API RAGFlow knowledge
enhancement workflow.

## notes

The local compiler keeps only minimal storyboard fallback. Specific layout and
shot planning content should come from this knowledge seed through RAGFlow JSON
enhancement.
