# Edits Protocol Review - 2026-06-15

结论：PASS

## 范围

只读审查当前工作区 `/Volumes/App_Dev/new_Prompt_prj`。未改代码，未 revert，未读取或打印 `真实配置.json`。未执行会写入 `.codex-agent-team/state/trace-store.jsonl` 或真实配置的测试。

## 协议结论

| 项目 | 结论 |
| --- | --- |
| endpoint | PASS。无 references/text_to_image 走 `/v1/images/generations`；有 references/image_to_image 走 `/v1/images/edits`。 |
| model | PASS。实现硬编码 `gpt-image-2`，配置中的 model/imageModel 不参与选择；未见 fallback model。 |
| edits multipart 字段 | PASS。当前 edits FormData 只追加 `model`、`prompt`、`image[]`。 |
| filename | PASS。`image[]` 使用 URL path basename 经 `safeReferenceFilename()` 清洗后的 filename；异常时 fallback 为 `reference.png`。 |
| MIME | PASS。参考图先 fetch 成字节，magic-byte 检测 `png/jpeg/webp`，声明 MIME 不匹配会拒绝，Blob type 使用检测 MIME。 |
| 不发送字段 | PASS。edits multipart 未追加 `n`、`size`、`quality`、`response_format`、`background`、`mask`。 |
| Content-Type | PASS。multipart submit 未手写 `Content-Type`，交给 fetch/FormData 自动带 boundary。 |
| mock/fallback success | PASS。provider 失败经错误映射返回失败，不制造成功图片。 |
| 泄露控制 | PASS。公共响应只返回 `images[].url` 和 warnings；base64/二进制进入 Generated Image Store URL；provider 错误映射为固定公共错误，不透出 raw response/key/prompt/reference URL。 |

## 关键依据

- `src/providers/ai-tu-provider-adapter.js`: `FIXED_IMAGE_MODEL = "gpt-image-2"`。
- `src/providers/ai-tu-provider-adapter.js`: 按 `generation_mode` 分流 generations/edits。
- `src/providers/ai-tu-provider-adapter.js`: edits FormData 只 append `model`、`prompt`、`image[]`。
- `tests/unit/image-api.test.js`: 单测锁定 `/v1/images/edits`、`image[]`、filename、MIME，并断言 unsupported knobs 不存在。
- `API_CONTRACTS.md`: 契约固定 `gpt-image-2`，禁止 fallback model 和错误 endpoint。
- `docs/spec/final_image_generation_api_spec_codex_autonomous_v1_4.md`: 最终 API 契约固定 provider model 和路由。

## 本次验证

- `node --check src/providers/ai-tu-provider-adapter.js`: PASS。
- `node --check src/routes/image-generations.js`: PASS。
- 未运行真实配置命令：遵守只读审查和敏感配置限制。
- 未运行全量测试：只读审查避免写入 trace。

## 剩余风险

- `docs/spec` 中 “structured reference URLs in provider image array” 的文字仍容易让后续实现误解为 URL array；当前代码实际是先 fetch reference，再用 multipart `image[]` 文件字段。
- filename 来自 URL basename，可能与检测 MIME 扩展名不一致；当前协议上 MIME 是正确来源。
- helper 级调用若传入空 URL image item，公共入口会拦住，但 `postSingleLiveImageEditMultipart` 自身应显式断言最终至少 append 一个 `image[]`。

## 建议测试

1. 增加双 reference 用例，断言提交两个 `image[]`，各自 filename/MIME 正确。
2. 增加 URL 扩展名与 magic MIME 不一致的 filename 策略用例。
3. 增加 FormData 最终无 `image[]` 时不发起 upstream submit 的 helper 级保护测试。
4. 由主 agent 在密钥安全环境下执行真实 provider smoke，不打印 config/raw response/prompt/reference URL/base64，只记录 endpoint、model、字段名、MIME、状态码级证据。
