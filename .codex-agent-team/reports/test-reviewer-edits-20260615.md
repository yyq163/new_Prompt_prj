# Test Reviewer Report: edits 2026-06-15

## 结论

PASS

本轮测试已覆盖目标清单的关键路径。只读审查未修改代码，未读取或打印真实配置文件。

## 覆盖矩阵

| 目标 | 结论 | 覆盖位置 |
| --- | --- | --- |
| `text_image` -> `/v1/images/generations` + `gpt-image-2` | PASS | `tests/unit/image-api.test.js` |
| `image/reference` with references -> `/v1/images/edits` + `gpt-image-2` | PASS | `tests/unit/image-api.test.js` |
| `storyboard` 有 references -> edits，无 references -> generations | PASS | `tests/unit/image-api.test.js` |
| multipart 图片字段 `image[]`、filename、MIME、prompt 非空 | PASS | `tests/unit/image-api.test.js` |
| 不出现其他模型 | PASS | `tests/unit/image-api.test.js`, `tests/integration/provider-config.test.js` |
| `data[0].image`、`data[0].result`、`base64`、`image_base64`、`data_url` 裸/URL base64 -> Generated Image Store URL | PASS | `tests/unit/image-api.test.js` |
| data URL、binary response -> Generated Image Store URL | PASS | `tests/unit/image-api.test.js` |
| invalid base64/wrong magic bytes 拒绝 | PASS | `tests/unit/image-api.test.js` |
| invalid base64/wrong magic bytes 不泄露 raw | PASS | public API envelope no-leak tests cover invalid encoded payloads |
| RAGFlow knowledge-driven template | PASS | `tests/unit/image-api.test.js` |
| RAGFlow binding decision 丢弃 | PASS | `tests/unit/image-api.test.js` |
| invalid body 回归 | PASS | `tests/unit/http-invalid-body.test.js` |
| callback 回归 | PASS | `tests/unit/image-api.test.js`, `tests/integration/final-v1-4-evidence.test.js` |
| Generated Image Store no-store 回归 | PASS | `tests/unit/image-api.test.js`, `tests/integration/final-v1-4-evidence.test.js`, `tests/unit/http-invalid-body.test.js` |

## 缺失测试

未发现阻断性缺失。

建议补强 1 个非阻断断言：invalid base64 / wrong magic bytes 当前在 normalizer/store 层有拒绝断言，但最好再加一条经过 `handleImageGeneration` 的公开响应测试，确认错误 envelope 不包含 raw 字段、encoded bytes、data URL、provider internals。

## 建议最小断言

1. 对 provider 返回 invalid base64 的公开 API 失败路径断言：`status === failed`、错误码为当前映射码、`images === []`，payload 不包含 raw/encoded/internal 字段。
2. 对 wrong magic bytes 的公开 API 失败路径断言同上。
3. multipart prompt 可再加一个更硬的断言：`typeof submittedBody.prompt === "string"` 且 trim 后非空。
