# Visual E2E Report: Final Image Generation API V1.4

Date: 2026-06-11

## Scope

- Page: `http://127.0.0.1:8793/`
- Source page: `ai-tu/ai-image-generator.html`
- Entry used: visible local image generation page
- Final endpoint: `POST /api/v1/image-generations`
- Change under test: RAGFlow knowledge-driven template repair with minimal local
  compiler fallback.

## Browser Steps

1. Attempted to open the local page in the Codex in-app Browser.
2. The in-app Browser webview did not attach twice, so validation continued in
   Codex-controlled Chrome, which was allowed by the task request.
3. Confirmed the visible title was `帧界图片生成器快速版`.
4. Filled the visible prompt textarea.
5. Selected `character_multiview`.
6. Saved the filled-form screenshot before submit.
7. Clicked the visible `开始生成` button.
8. Observed the real Final API request complete with an explicit provider
   failure.
9. Retried a minimal `text_image` path and a direct curl path; both remained
   blocked by the real provider.

## Result

- HTTP status: `502`
- API status: `failed`
- Error code: `IMAGE_PROVIDER_CALL_FAILED`
- Task type: `character_multiview`
- Generation mode: `text_to_image`
- Reference count: `0`
- Image count from final API trace: `0`
- Image preview visible: `false`
- Generated image route used: no
- Trace id: `trace_38caff6d133c400289`
- Generation id: none
- Blocked: `true`

Provider configuration was present, so the validation used the real upstream
provider. The provider returned no image URL or bytes. A direct upstream probe
returned HTTP `429` with a saturation/retry-later message, and a cooldown retry
through the Final API still returned `502 IMAGE_PROVIDER_CALL_FAILED`.

## Generated Image Route Check

- `GET /api/v1/generated-images/:image_id`: not run
- `Content-Type`: not available
- `Content-Length`: not available
- `Cache-Control`: not available
- Downloaded bytes were verified as PNG: no
- Blocker: provider did not return an image id, image URL, or image bytes.

## Safety Checks

- 内部提示词可见：否
- 上游请求细节可见：否
- 图片编码文本可见：否
- 敏感凭据可见：否
- 回调投递状态可见：否
- 增强链路运行状态可见：否
- 专业模板无条件 fallback 可见：否

## Artifacts

- Final screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Filled-form pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Network summary: `evidence/final-v1-4-network-summary.json`

## Notes

- The final screenshot shows the explicit provider failure state.
- The pre-submit screenshot shows the filled prompt and selected
  `character_multiview` path before clicking `开始生成`.
- No success was mocked.
