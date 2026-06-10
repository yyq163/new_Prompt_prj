# Visual E2E Report: Final Image Generation API

Date: 2026-06-10

## Scope

- Page: `http://127.0.0.1:8787/`
- Source page: `ai-tu/ai-image-generator.html`
- Entry used: visible ai-tu page, not standalone API script
- Final endpoint: `POST /api/v1/image-generations`

## Browser Steps

1. Opened `http://127.0.0.1:8787/` in Codex Browser.
2. Confirmed the page title is `帧界图片生成器快速版`.
3. Selected `scene_multiview`.
4. Filled prompt: `生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图`.
5. Filled three structured URL references:
   - `ref_char_1`, `萧昭宁`, `character`, `character_reference`
   - `ref_char_2`, `萧昭宁`, `character`, `face_reference`
   - `ref_scene_1`, `营帐`, `scene`, `scene_reference`
6. Confirmed the page did not require or display `usage`, `primary`, or `auxiliary`.
7. Clicked the visible `开始生成` button.
8. Waited for the real provider result.
9. Confirmed the page displayed `生成完成` and a visible generated image preview.

## Result

- HTTP status: `200`
- API status: `succeeded`
- Task type: `scene_multiview`
- Generation mode: `image_to_image`
- Reference count: `3`
- Image count from final API trace: `1`
- Image preview visible: `true`
- Image URL kind: `service_generated_image_url_from_real_provider_bytes`
- Generated image route used: `/api/v1/generated-images/:image_id`
- Trace id: `trace_e54714c1b6874898ba`
- Generation id: `gen_8bb2801fa71244cf93`
- Blocked: `false`

The provider returned real image bytes. The service stored those bytes in Generated Image Store and returned a temporary generated-image URL for browser preview.

## Generated Image Route Check

- `GET /api/v1/generated-images/:image_id`: `200`
- `Content-Type`: `image/png`
- `Content-Length`: `2504876`
- `Cache-Control`: `no-store`
- Downloaded bytes were verified as a PNG image.

## Privacy Checks

- forbidden internal fields visible: `false`
- raw provider payload visible: `false`
- raw generated-image bytes or base64 visible: `false`
- secret header or cookie visible: `false`
- callback status visible: `false`
- RAGFlow or fallback status visible: `false`

## Artifacts

- Final screenshot: `evidence/screenshots/final-image-generation-api-e2e.png`
- Filled-form pre-submit screenshot: `evidence/screenshots/final-image-generation-api-e2e-before-submit.png`
- Network summary: `evidence/network-summary.json`

## Notes

- The final screenshot shows the visible generated image preview after completion.
- The pre-submit screenshot shows all three structured reference rows filled before clicking `开始生成`.
- Network summary uses sanitized trace metadata plus browser-visible completion state. It does not store request bodies, provider payload, generated-image bytes, raw base64, keys, Authorization headers, Cookies, internal prompts, or raw enhancement output.
