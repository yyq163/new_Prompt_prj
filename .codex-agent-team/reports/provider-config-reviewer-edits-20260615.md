# Provider Config Review: Edits Routing 2026-06-15

## 结论: PASS

只读审查通过。当前实现对 Final API provider 配置和路由满足目标约束：模型固定为 `gpt-image-2`；无 references 的文本生图走 `/v1/images/generations`；带 references 的 image/reference/storyboard 等图生图走 `/v1/images/edits`；未发现运行时代码使用 `gpt-image-2-all`、`gpt-image-1`、`dall-e-*` 或 fallback model；provider 失败路径没有 mock success。

本次未读取或打印 `真实配置.json`，未修改代码，未 revert。

## 证据

- `src/providers/ai-tu-provider-adapter.js`: 默认 provider endpoints 分离为 generations 与 edits；固定模型常量为 `gpt-image-2`。
- `src/providers/ai-tu-provider-adapter.js`: provider payload 写死 `model: gpt-image-2`。
- `src/providers/ai-tu-provider-adapter.js`: `image_to_image` 分支走 multipart edits，否则走 JSON generations。
- `src/providers/ai-tu-provider-adapter.js`: `sanitizeProviderConfig` 强制输出 `model` 和 `imageModel` 都为 `gpt-image-2`。
- `src/providers/ai-tu-provider-adapter.js`: generations endpoint 必须以 `/v1/images/generations` 结尾。
- `src/providers/ai-tu-provider-adapter.js`: edits endpoint 必须以 `/v1/images/edits` 结尾。
- `src/core/runtime.js`: `generation_mode` 由 references 是否存在派生。
- `src/core/reference-binding.js`: `text_image` 禁止 references，`image_reference` 要求至少一张 reference。
- `tests/integration/provider-config.test.js`: 集成测试断言 generations/edits endpoint 后缀、固定模型、禁用旧模型名。
- `tests/unit/image-api.test.js`: 真实 adapter 测试覆盖 text generation、reference-backed tasks、storyboard 有/无 references 的 endpoint/model 分流。
- `tests/unit/image-api.test.js`: provider 失败测试覆盖 text/image 失败不会 mock success。
- `API_CONTRACTS.md` 与 `docs/spec/final_image_generation_api_spec_codex_autonomous_v1_4.md`: 契约明确固定模型、路由规则、禁止 mock success。

验证命令：

- `npm run check`: exit 0。
- 只读动态探针：使用临时环境变量和内存 fetch recorder，未读取本地真实配置；结果确认 text/image/storyboard 路由均符合 endpoint/model 约束。

未运行全量测试，避免只读审查写入 trace。未运行带 `真实配置.json` 的 provider-config 集成命令。

## 风险

- `generateWithAiTuProvider` 当前信任内部 `request.generation_mode`，虽然公开入口由 `normalizeRequest` 从 references 派生，但 adapter 自身没有二次断言 references 与 generation_mode 一致。当前公开路径未发现违规，但这是低成本可加固点。
- 未验证真实上游配置和真实 provider 可用性；本结论只覆盖代码、契约、测试护栏和不触碰真实配置的路由探针。

## 最小建议

1. 在 provider adapter 内部用 `request.references.length > 0` 直接派生分支，或至少断言它与 `generation_mode` 一致。
2. 增加一组防御性单测：内部 request 若 references 与 generation_mode 不一致，应拒绝或仍按 references 分派。
3. CI 保留 provider-config 测试，但真实配置执行结果只记录布尔/摘要，不输出配置、key、prompt、body 或 base64。
