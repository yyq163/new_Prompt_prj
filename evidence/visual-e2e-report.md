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

1. Opened the local page in the Codex in-app Browser.
2. Confirmed the visible title was `帧界图片生成器快速版`.
3. Filled the visible prompt textarea with a `character_multiview` request.
4. Selected `character_multiview` in the visible task type control.
5. Saved the filled-form screenshot before submit.
6. Clicked the visible `开始生成` button.
7. Observed the page record a completed generation with a visible generated
   image URL under `/api/v1/generated-images/`.
8. Cross-checked the accepted browser run against the backend trace store and
   generated-image GET route.

## Result

- Browser surface: Codex in-app Browser
- HTTP status: `200`
- API status: `succeeded`
- Task type: `character_multiview`
- Generation mode: `text_to_image`
- Reference count: `0`
- Image count from final API trace: `1`
- Image preview visible: `true`
- Generated image route used: yes
- Trace id: `trace_5b17210c1a3a4d0587`
- Generation id: `gen_2741feb461b843db9b`
- Image URL: `http://127.0.0.1:8793/api/v1/generated-images/img_c30fffcfab2447bc807553fe25561e37`
- Blocked: `false`

The provider configuration was present and the accepted browser run used the
real Final API provider path. No provider success was mocked. Later exploratory
provider probes were not used as acceptance evidence and are not part of this
accepted run.

## Generated Image Route Check

- `GET /api/v1/generated-images/:image_id`: HTTP `200`
- `Content-Type`: `image/png`
- `Content-Length`: `1999538`
- `Cache-Control`: `no-store`
- Downloaded bytes were verified as PNG: yes

## Safety Checks

- 内部提示词可见：否
- 上游请求细节可见：否
- 图片编码文本可见：否
- 敏感凭据可见：否
- 回调投递状态可见：否
- 增强链路运行状态可见：否
- 专业模板无条件 fallback 可见：否

## Artifacts

- Final page-state screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Filled-form pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Network summary: `evidence/final-v1-4-network-summary.json`

Both screenshot files are PNG image files. The screenshot artifacts are kept as
visible page-operation evidence. The authoritative success evidence is the
browser submission state, trace-store record, network summary, and
generated-image GET headers above.
