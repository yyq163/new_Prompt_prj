# Visual E2E Report: Final Image Generation API

Date: 2026-06-09

## Scope

- Page: `http://127.0.0.1:8787/`
- Source page: `ai-tu/ai-image-generator.html`
- Entry used: visible ai-tu page, not standalone Image API Console
- Final endpoint: `POST /api/v1/image-generations`

## Browser Steps

1. Opened `http://127.0.0.1:8787/`.
2. Confirmed the page title is `帧界图片生成器快速版`.
3. Selected `scene_multiview`.
4. Filled prompt: `生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图`.
5. Filled three URL references:
   - `ref_char_1`, `萧昭宁`, `character`, `character_reference`
   - `ref_scene_1`, `营帐`, `scene`, `scene_reference`
   - `ref_char_2`, `萧昭宁`, `character`, `face_reference`
6. Confirmed the page did not require or display `usage`, `primary`, or `auxiliary`.
7. Clicked the visible `开始生成` button.
8. Waited for the real provider result.
9. Confirmed the page displayed `生成完成`, a generation id, and one generated image preview.

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
- Blocked: `false`

The provider returned real image bytes rather than an external provider URL. The service stored those real provider bytes in Generated Image Store and returned a temporary generated-image URL for browser preview.

## Privacy Checks

- forbidden internal fields visible: `false`
- raw provider payload visible: `false`
- raw generated-image bytes or base64 visible: `false`
- secret header or cookie visible: `false`

## Artifacts

- Screenshot: `evidence/screenshots/final-image-generation-api-e2e.png`
- Network summary: `evidence/network-summary.json`

## Notes

- The screenshot shows the ai-tu original page, three filled reference rows, no primary/auxiliary UI, and a visible generated image preview.
- Network summary uses the sanitized final API trace plus browser-visible completion state. It records endpoint/status/image-count only and does not store request bodies, provider payload, or generated-image bytes.
