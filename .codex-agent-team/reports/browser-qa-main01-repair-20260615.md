# Browser QA 报告 — main01 repair（2026-06-15）

## 测试环境

- 仓库：`/Volumes/App_Dev/new_Prompt_prj`
- 分支：`main01`
- HEAD：`b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f`
- 本地服务：`http://127.0.0.1:8787`
- 浏览器：Kimi WebBridge / Codex-controlled Chrome（daemon v1.9.17，extension v1.9.13）
- 配置来源：`真实配置.json`（本地真实 provider 配置），敏感值未泄露
- 运行补充：通过环境变量强制指定上游 endpoint，避免配置文件中 `baseUrl` 指向 edits 导致文生图校验失败
  - `IMAGE_API_BASE=https://memefast.top/v1/images/generations`
  - `IMAGE_EDIT_BASE=https://memefast.top/v1/images/edits`
- 模型：`gpt-image-2`（后端 `FIXED_IMAGE_MODEL` 强制，不可通过配置覆盖）
- 测试时间：2026-06-15

## 文生图结果

| 检查项 | 结果 |
|---|---|
| 打开页面并输入 prompt | ✅ 通过 |
| Provider endpoint 为 `/v1/images/generations` | ✅ 通过（后端配置 `baseUrl` 校验通过） |
| 模型为 `gpt-image-2` | ✅ 通过 |
| `/api/v1/image-generations` HTTP 200 | ✅ 通过 |
| 响应 `status: succeeded` | ✅ 通过 |
| 返回 `public images[].url` | ✅ 通过（本地 `/api/v1/generated-images/<id>`） |
| 页面预览窗可见生成图片 | ✅ 通过（`previewNaturalWidth > 0`） |
| GET 图片返回 200 | ✅ 通过 |
| `Content-Type: image/png` | ✅ 通过 |
| `Cache-Control: no-store` | ✅ 通过 |

- 失败项：无
- 上游脱敏摘要：HTTP 200，无 public error code，未记录 raw request/response/key/prompt。

## 图生图结果

| 检查项 | 结果 |
|---|---|
| 从 `/Volumes/App_Dev/test-image` 自动选取参考图 | ✅ 通过（`image_20260108131455.jpeg`） |
| 通过浏览器上传参考图到 `/api/reference-images` | ✅ 通过（HTTP 200） |
| 生成请求携带 reference URL | ✅ 通过 |
| Provider endpoint 为 `/v1/images/edits` | ✅ 通过（后端配置 `imageEditUrl` 校验通过） |
| 模型为 `gpt-image-2` | ✅ 通过 |
| `/api/v1/image-generations` HTTP 200 | ✅ 通过 |
| 响应 `status: succeeded` | ✅ 通过 |
| 返回 `public images[].url` | ✅ 通过（本地 `/api/v1/generated-images/<id>`） |
| 页面预览窗可见生成图片 | ✅ 通过（`previewNaturalWidth > 0`） |
| GET 图片返回 200 | ✅ 通过 |
| `Content-Type: image/png` | ✅ 通过 |
| `Cache-Control: no-store` | ✅ 通过 |

- 失败项：无
- 上游脱敏摘要：HTTP 200，无 public error code，未记录 raw request/response/key/prompt/reference URL。

## 截图策略

- 本轮选择**不跟踪截图**。
- 仅在本地保留两张截图，用于必要时人工复核：
  - `evidence/screenshots/browser-qa-main01-text.png`
  - `evidence/screenshots/browser-qa-main01-image.png`
- 这些文件位于 `.gitignore` 已忽略的 `evidence/screenshots/` 目录下，**不会提交到仓库**。
- 报告中仅标记为 `local-only`，不嵌入截图内容。

## 失败项

无。

## Verdict

**PASS** — 文生图与图生图均通过真实浏览器完成端到端验证，provider endpoint、模型、HTTP 状态、返回图片 URL、页面可见性及图片响应头均符合预期。
