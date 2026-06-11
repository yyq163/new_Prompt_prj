# Visual E2E Report: Final Image Generation API V1.4

Date: 2026-06-11

## Scope

- Page: `http://127.0.0.1:8792/`
- Source page: `ai-tu/ai-image-generator.html`
- Entry used: visible local image generation page
- Final endpoint: `POST /api/v1/image-generations`

## Browser Steps

1. Opened the local page in the Codex in-app Browser.
2. Confirmed the visible title was `帧界图片生成器快速版`.
3. Filled the visible prompt textarea.
4. Selected `text_image`.
5. Confirmed no reference rows were used for the text-only path.
6. Saved the filled-form screenshot before submit.
7. Clicked the visible `开始生成` button.
8. Waited for the real upstream result.
9. Confirmed the page displayed `生成完成` with a visible generated image preview.

## Result

- HTTP status: `200`
- API status: `succeeded`
- Task type: `text_image`
- Generation mode: `text_to_image`
- Reference count: `0`
- Image count from final API trace: `1`
- Image preview visible: `true`
- Generated image route used: `/api/v1/generated-images/:image_id`
- Trace id: `trace_498493fb085144d8ac`
- Generation id: `gen_eb0bdb009b9842babe`
- Blocked: `false`

The upstream returned real image bytes. The service stored them in Generated Image Store and returned a temporary generated-image URL for browser preview.

## Generated Image Route Check

- `GET /api/v1/generated-images/:image_id`: `200`
- `Content-Type`: `image/png`
- `Content-Length`: `3118845`
- `Cache-Control`: `no-store`
- Downloaded bytes were verified as PNG.

## Safety Checks

- 内部提示词可见：否
- 上游请求细节可见：否
- 图片编码文本可见：否
- 敏感凭据可见：否
- 回调投递状态可见：否
- 增强链路运行状态可见：否

## Artifacts

- Final screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Filled-form pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Network summary: `evidence/final-v1-4-network-summary.json`

## Notes

- The final screenshot shows the visible generated image preview after completion.
- The pre-submit screenshot shows the filled prompt and selected `text_image` path before clicking `开始生成`.
- The network summary stores sanitized trace metadata and browser-visible completion state only.
