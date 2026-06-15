# Code Reviewer Report 2026-06-15

P0：无。

## Findings

### P1：`image_to_image` 新增的 reference URL 代抓取没有大小、超时、MIME/魔数校验

`src/providers/ai-tu-provider-adapter.js` 直接 `fetchImpl(url)` 后 `arrayBuffer()`，并信任 `content-type` 组 multipart。由于结构化 `references[].url` 可以是任意公网 HTTP(S)，上游 URL 返回超大响应或非图片内容时会造成内存风险或无效上传。

建议：加响应体上限、Abort 超时、Content-Length 预检、流式读取上限，以及 PNG/JPEG/WEBP 魔数校验。

### P1：provider-returned unsafe URL 校验只在 Final API route 上做，legacy `/api/image-jobs` 仍可绕过

Final API 会拒绝 localhost/内网/provider 非法 scheme；但 legacy job 调 provider 后直接写入 `job.images` 并返回。若该兼容端点仍暴露，provider 返回 `http://127.0.0.1/...` 一类 URL 会绕开新校验。

建议：把 URL 安全归一化提到共享层，或明确关闭/限制 legacy route。

### P2：`/api/reference-images` 的合同回归测试还不够完整

新增测试只验证上传成功和本地图片可读。还缺两个关键断言：helper 返回的 URL 放进完整结构化 `references[]` 后能走 `/api/v1/image-generations` 的 `image_to_image`；只有 URL 的 reference 仍被拒绝，不能绕过 `reference_id/entity_name/entity_type/role` 合同。

### P2：provider failure 覆盖偏 adapter 层，Final API 公共错误合同覆盖不足

目前有 edits adapter 失败测试和缺配置测试，但缺 `handleImageGeneration` 层面对 text_to_image 上游失败、image_to_image 上游失败的公开响应断言。

## 正向确认

- provider 模型已固定 `gpt-image-2`。
- 无 references 走 `/v1/images/generations`。
- 有 references 走 `/v1/images/edits`。
- Final API 主入口仍是 JSON read/parse，没有接收 multipart。

## 放行建议

不建议放行。主合同方向是对的，但两个 P1 都在安全边界上，建议修完并补 P2 回归后再放。

本次按只读要求审查，未修改文件，未读取 `.env` 或真实配置 JSON 内容，未运行测试。
