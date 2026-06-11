# Final Image Generation API

独立部署的最终版提示词优化生图 API 服务。当前仓库根目录就是正式服务入口，`ai-tu/` 只作为只读 provider 能力迁移来源。

## 启动

```bash
npm start
```

默认地址：

- 测试台：`http://127.0.0.1:8787/`
- 健康检查：`http://127.0.0.1:8787/health`
- API：`POST http://127.0.0.1:8787/api/v1/image-generations`

HTTP 请求体必须是合法 JSON，且不能超过 `MAX_BODY_SIZE`。非法 JSON 或超大请求体会在 HTTP 层直接返回 `400 INVALID_REQUEST_SCHEMA`，不会进入 provider 调用。

## Provider 配置

服务优先从环境变量读取真实 provider 配置；如果未设置，则只读读取 `ai-tu/runtime-config.json`，也可以用 `AI_TU_RUNTIME_CONFIG_FILE` 指向 ai-tu 的运行时配置文件。

- `IMAGE_API_BASE`
- `IMAGE_MODEL`
- `IMAGE_MODEL_IMAGE` 或 `IMAGE_MODEL_FOR_IMAGE`
- `IMAGE_API_KEY` 或 `IMAGE_API_KEYS`
- `REQUEST_TIMEOUT_SECONDS`
- `UPSTREAM_RETRY_ATTEMPTS`
- `IMAGE_PROVIDER_POLL_BASE`
- `IMAGE_PROVIDER_POLL_TIMEOUT_SECONDS`
- `IMAGE_PROVIDER_POLL_INTERVAL_SECONDS`
- `PUBLIC_BASE_URL`

如果 ai-tu 配置只提供 `imageModel` 和 key，服务会使用 ai-tu 默认 JSON generations endpoint，并以 `imageModel` 作为 model。缺少 provider model 或 key 时，服务返回 `PROVIDER_CONFIG_MISSING`，不会返回假成功。

`PUBLIC_BASE_URL` 用于生成 Generated Image Store 的公网图片 URL。生产环境必须配置 HTTP(S) base URL；服务会去掉尾部 `/` 后拼接 `/api/v1/generated-images/:image_id`。本地开发未配置时才回退到当前本地 host，不在生产环境静默返回 `127.0.0.1`。

## 边界

- 不运行时 import/require `ai-tu/gateway/server.js`。
- 不接收图片文件上传。
- 不做 multipart、图床上传、参考图上传或本地文件转存。
- `references[]` 采用严格结构化协议，不支持只有 URL 的引用对象：`reference_id`、`entity_name`、`entity_type`、`role`、`url` 均为必填字段，且 `reference_id` 在单次请求内必须唯一。
- `entity_type` 与 `role` 必须使用 API 合同中的枚举值；`pattern_reference` 仅兼容映射为 `ornament_reference`。
- 旧请求中的 `usage` 字段可以被接收，但当前版本会忽略它，不参与权重、排序或阻断，也不会在响应中返回。
- 同一 `entity_name + role` 可以有多张参考图，系统会全部使用；未被 prompt 显式 mention 的参考图也会参与编译和 provider 请求。
- Provider 返回的 URL、base64、data URL 或 binary 生成图会统一标准化为 `images[].url`；其中真实上游 bytes 会通过短期内存 Generated Image Store 暴露为 `/api/v1/generated-images/:image_id`。
- `callback_url` / `callback.url` 只接收和校验，不执行回调。校验默认拒绝 localhost、loopback、link-local、内网地址和非 HTTP(S) scheme。
- 兼容路由 `/api/image-jobs` 已标记 deprecated，仅服务旧页面/旧客户端，不作为 Final API V1.4 验收入口，也不允许 URL-only reference 绕过结构化合同。
- API 响应不返回 final prompt、compiled prompt、enhancement、RAGFlow 状态、fallback 状态、storyboard 路径或 provider payload。
- 专业模板内容由 RAGFlow 知识库命中后返回 JSON enhancement，再由 Prompt Compiler 确定性拼接；Prompt Compiler 本地只保留最小安全骨架、参考绑定、输出说明和通用负向规则。
- RAGFlow 未配置、调用失败、无知识命中或 enhancement 被安全校验丢弃时，服务仍可继续生图，但不会自动补人物四视图、场景 3×3、多机位、道具多角度或故事板左右分区等完整专业模板。
- RAGFlow 系统提示词和知识库 seed 见 `docs/ragflow/`；系统提示词只定义 JSON 协议和防幻觉边界，模板正文在 `docs/ragflow/knowledge/`。
- 当前阶段不宣称完成工业级高并发能力；现状见 `docs/concurrency-status.md`。

## 测试

```bash
npm run check
npm test
node tests/integration/provider-config.test.js
node tests/integration/final-v1-4-evidence.test.js
git diff --check
```

集成检查没有真实 provider 环境变量时会报告 `BLOCKED_BY_MISSING_PROVIDER_CONFIG`，这是预期的安全阻断，不代表业务验收通过。
