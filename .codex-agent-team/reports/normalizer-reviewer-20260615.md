# Normalizer Reviewer Report 2026-06-15

## 结论

PASS（静态只读审查，未改代码，未读取/打印真实配置，未运行可能写入状态的测试）。

本轮修复覆盖目标路径：编码图片与二进制图片会进入 Generated Image Store，public `POST /api/v1/image-generations` 响应会裁剪为 `images[].url`，非法编码/错误图片魔数会被拒绝并映射为公共错误，不外露原始图片载荷。

## 覆盖矩阵

| 输入形态 | 实现覆盖 | 进入 Store | Public API 只返 URL | 测试覆盖 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `b64_json` | `encodedImageValue` + `generatedImageFromEncoded` | 是 | 是 | 有 `data[0].b64_json` 与 public API 测试 | PASS |
| `base64` | 同上 | 是 | 是 | 有 `data[0].base64` 表驱动 | PASS |
| `image_base64` | 同上 | 是 | 是 | 有 `data[0].image_base64` 表驱动 | PASS |
| `data_url` / data URL | 同上，先解析 MIME 再存储 | 是 | 是 | 有字段与 `image` data URL 测试 | PASS |
| `data[0].b64_json` | `json.data.forEach(pushImage)` | 是 | 是 | 有 | PASS |
| `data[0].base64` | 同上 | 是 | 是 | 有 | PASS |
| `data[0].image` | 对 data URL 或疑似编码串识别 | 是 | 是 | 有裸编码与 data URL | PASS |
| `data[0].result` | 对疑似编码串识别 | 是 | 是 | 有裸编码 | PASS |
| direct HTTP `image/*` | `fetchUpstreamOnce` 包装为 `data[].binary` | 是 | 是 | 有 `fetchUpstreamOnce` 与 `postLiveJson` | PASS |
| direct `Buffer` | `normalizeProviderImageObject(Buffer)` | 是 | 间接安全 | 有 | PASS |
| `ArrayBuffer` | `normalizeImageBytes` 支持 | 是 | 间接安全 | 建议显式补强 | PASS with gap |
| `Uint8Array` / typed array | `ArrayBuffer.isView` 支持 | 是 | 间接安全 | 建议显式补强 | PASS with gap |

## 泄露风险

未发现 public JSON 泄露原始编码、二进制字段、provider 内部字段或凭据的路径。`handleImageGeneration` 只输出 `status/images/warnings`，且每个 image 只含 `url`；失败响应也固定为 `error/images/status/warnings`。

注意：normalizer 内部返回对象仍含 `image_id/mime/size/url_kind` 等内部元数据，这是内部层可接受状态；风险点只在未来若绕过 `image-generations` 路由直接公开 normalizer 结果。

## 缺失测试

- 缺少顶层 `b64_json/base64/image_base64/data_url` 的显式表驱动测试；当前实现覆盖，但测试主要锁在 `data[0]`。
- 缺少 direct `ArrayBuffer`、`Uint8Array`、其他 typed array 直接传入 `normalizeProviderImageObject` 或 `{ binary }/{ bytes }/{ buffer }/{ data }` 的单测。
- 缺少 `data[0].image/result` 非法编码字段的专门断言；当前会拒绝为空结果或非法结果，但建议明确锁定公共错误不外露原始载荷。

## 最小建议

1. 增加一组只断言 URL/Store/MIME 的表驱动单测，覆盖顶层编码字段与 `data[0]` 编码字段。
2. 增加 direct binary 表驱动单测：`Buffer`、`ArrayBuffer`、`Uint8Array`、至少一个其他 typed array。
3. 增加 public API 失败路径快照式断言：非法编码、错误魔数、MIME 不匹配均只返回公共错误结构，且 `images` 为空。
