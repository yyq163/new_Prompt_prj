# Visual E2E Report: Final Image Generation API

Date: 2026-06-10

## Scope

- Page: `http://127.0.0.1:8791/`
- Source page: `ai-tu/ai-image-generator.html`
- Entry used: visible ai-tu page
- Final endpoint: `POST /api/v1/image-generations`

## Browser Steps

1. Opened the local page in Codex Browser.
2. Confirmed the visible title was `帧界图片生成器快速版`.
3. Selected `scene_multiview`.
4. Filled a prompt that mentions `@萧昭宁` and `@营帐`.
5. Filled three structured URL reference rows with required fields.
6. Confirmed old priority controls were not part of the visible flow.
7. Clicked the visible `开始生成` button.
8. Waited for the real provider result.
9. Confirmed the page displayed `生成完成` with a visible generated image preview.

## Result

- HTTP status: `200`
- API status: `succeeded`
- Task type: `scene_multiview`
- Generation mode: `image_to_image`
- Reference count: `3`
- Image count from final API trace: `1`
- Image preview visible: `true`
- Generated image route used: `/api/v1/generated-images/:image_id`
- Trace id: `trace_566adaa7bda24623b5`
- Generation id: `gen_1a1bc7c910a94647a3`
- Blocked: `false`

The provider returned real image bytes. The service stored them in Generated Image Store and returned a temporary generated-image URL for browser preview.

## Generated Image Route Check

- `GET /api/v1/generated-images/:image_id`: `200`
- `Content-Type`: `image/png`
- `Content-Length`: `2403683`
- `Cache-Control`: `no-store`
- Downloaded bytes were verified as PNG.

## Privacy Checks

- forbidden response fields visible: `false`
- sensitive provider details visible: `false`
- encoded image text visible: `false`
- credential strings visible: `false`
- callback delivery metadata visible: `false`
- enhancement runtime status visible: `false`

## Artifacts

- Final screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Filled-form pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Network summary: `evidence/final-v1-4-network-summary.json`

## Notes

- The final screenshot shows the visible generated image preview after completion.
- The pre-submit screenshot shows all three structured reference rows filled before clicking `开始生成`.
- The network summary stores sanitized trace metadata and browser-visible completion state only.
