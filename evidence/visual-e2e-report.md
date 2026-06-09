# Visual E2E Report: Final Image Generation API

Date: 2026-06-09

Page:
- `http://127.0.0.1:8787/`
- Source page: `ai-tu/ai-image-generator.html`

Scope:
- Final API visual E2E for `POST /api/v1/image-generations`.
- The page used the ai-tu original UI, not the independent Image API Console.
- The request was triggered by the visible `开始生成` button.

Input Checks:
- `task_type=scene_multiview`
- `references[].url` filled: true
- `references[].entity_name` filled: true
- `references[].role` filled: true
- `references[].usage` filled: true
- Reference rows:
  - `ref_char`, `萧昭宁`, `character_reference`, `auxiliary`, `url_present=true`
  - `ref_scene`, `营帐`, `scene_reference`, `primary`, `url_present=true`

Network Evidence:
- `method=POST`
- `endpoint=/api/v1/image-generations`
- `http_status=200`
- `trace_id=trace_f8cfe50955db4268ac`
- `request_id_present=true`
- `generation_id_present=true`

Provider Result:
- `provider_config_ready=true`
- `real_provider_attempted=true`
- `api_status=succeeded`
- `image_count=1`
- `image_url_returned=true`
- `image_preview_visible=true`
- `image_url_kind=local_generated_image_url_from_real_upstream_bytes`
- `BLOCKED=false`

Implementation Note:
- The upstream provider returned real image bytes in `b64_json` instead of an external URL.
- The provider adapter now stores those real upstream bytes in memory and returns a short-lived service URL under `/api/v1/generated-images/<id>` for browser preview.
- No mock image, fake success, imgbb upload, multipart upload, or local file conversion was used.

Privacy Checks:
- final_prompt visible: false
- compiled_prompt visible: false
- enhancement visible: false
- RAGFlow raw output visible: false
- fallback status visible: false
- provider internal payload visible: false
- callback_status visible: false
- key/token visible: false

Artifacts:
- Screenshot: `/Volumes/App_Dev/new_Prompt_prj/evidence/screenshots/final-image-generation-api-e2e.png`
- Network summary: `/Volumes/App_Dev/new_Prompt_prj/evidence/network-summary.json`
