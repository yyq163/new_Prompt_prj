# Browser QA: gpt-image-2 edits debug 2026-06-15

## 结论

BLOCKED

真实浏览器已覆盖文生图和图生图路径，未使用 mock success。文生图回归 PASS；图生图真实上传 PASS，但 `/api/v1/image-generations` 返回 502 `PROMPT_IMAGE_BACKEND_UNAVAILABLE`，无图片 URL，因此无法执行生成图 GET。

## 环境

- 本地页面：`http://127.0.0.1:8795/`
- Provider model：`gpt-image-2`
- 文生图合同 endpoint：`/v1/images/generations`
- 图生图合同 endpoint：`/v1/images/edits`
- 真实配置：已使用本地真实配置，敏感值未泄露。
- 参考图：自动选择 `/Volumes/App_Dev/test-image` 中最小 JPEG；报告只记录 MIME/大小。

## Text Image

- UI 操作：打开页面，选择 `text_image`，填写 prompt，点击“开始生成”。
- Final API POST：HTTP 200。
- Public status：`succeeded`。
- 耗时：128754 ms。
- 图片数：1。
- 页面预览：可见。
- GET generated image：HTTP 200，`Content-Type: image/png`，`Cache-Control: no-store`，大小 2637796 bytes。
- 截图：`evidence/screenshots/browser-text-generation-edits-debug-20260615.png`。

## Image Edit

- UI 操作：打开页面，选择 `image_reference`，上传真实参考图，点击“开始生成”。
- `/api/reference-images`：HTTP 200，`status=succeeded`，MIME `image/jpeg`，大小 382395 bytes，host `generated-image-store`。
- Final API POST：HTTP 502。
- Public status：`failed`。
- Public error code：`PROMPT_IMAGE_BACKEND_UNAVAILABLE`。
- 耗时：10697 ms。
- 图片数：0。
- 页面预览：无生成图预览。
- GET generated image：无图片 URL，未执行。
- 截图：`evidence/screenshots/browser-image-generation-edits-debug-20260615.png`。

## 安全

- summary 文件已脱敏 generated image URL。
- `node tests/integration/final-v1-4-evidence.test.js`：PASS。
- 未记录 raw provider request/response、Authorization、Cookie、API key、token、真实配置内容、raw base64、inline data URI、完整 prompt 或完整 reference URL。
