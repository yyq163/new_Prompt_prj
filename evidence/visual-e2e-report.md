# Visual E2E Report: 6 Task Type Prompt Optimizer

Date: 2026-06-09

Page:
- `http://127.0.0.1:8787/`
- Source page: `ai-tu/ai-image-generator.html`

Config Checks:
- `config_source=ai-tu/runtime-config.example.json`
- `ragflow_config_present=true`
- `ragflow_base_is_18080=true`
- `ragflow_chat_endpoint_reachable=true`
- `ragflow_returned_choices=true`
- `BLOCKED=false`

Shared Visual Checks:
- ai-tu original page opened: true
- Independent Image API Console used: false
- Prompt optimizer entry used: true
- 6 task_type selector present: true
- `POST /api/prompt-optimizer` triggered from page: true
- Prompt textarea overwritten on success: true
- Field-summary headings in prompt box: false
- Internal or secret fields visible: false
- Current output is compiled by backend Prompt Compiler: true
- RAGFlow raw output visible: false

6 Task Type Cases:
- `text_image`: passed, ordinary text-to-image prompt, no professional template mismatch.
- `image_reference`: passed, ordinary reference-image prompt, reference entity preserved, no professional template mismatch.
- `character_multiview`: passed, character four-view prompt with front full body, head close-up, side full body, back full body.
- `scene_multiview`: passed, scene multiview / multi-camera / live lighting prompt, no previous fixture entity bleed.
- `prop_multiview`: passed, prop asset multiview prompt with structure, material, proportion and close-up details.
- `storyboard`: passed, storyboard prompt with left planning area and right story grid area, not fixed nine-grid, no shot count or duration limit.

Screenshots:
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-text_image.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-image_reference.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-character_multiview.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-scene_multiview.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-prop_multiview.png`
- `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/ai-tu-prompt-optimizer-six-type-storyboard.png`
