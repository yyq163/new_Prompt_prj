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
- 浏览器参考图上传辅助：`POST http://127.0.0.1:8787/api/reference-images`

HTTP 请求体必须是合法 JSON，且不能超过 `MAX_BODY_SIZE`。非法 JSON 或超大请求体会在 HTTP 层直接返回 V3.6 失败 envelope，`error.code` 为 `INVALID_REQUEST_SCHEMA`，不会进入 provider 调用。客户端校验类错误保留原始 4xx code；provider/upstream 错误才会脱敏映射为通用后端错误。

## Provider 配置

服务优先从环境变量读取真实 provider 配置；如果未设置，则当前工作区默认只读读取根目录 `真实配置_toapis.md`。当前仓库只保留这一份权威运行时配置文件；如需临时覆盖，只能通过 `AI_TU_RUNTIME_CONFIG_FILE` 显式指定。

- `IMAGE_API_BASE`
- `IMAGE_EDIT_BASE`
- `IMAGE_API_KEY` 或 `IMAGE_API_KEYS`
- `REQUEST_TIMEOUT_SECONDS`
- `UPSTREAM_RETRY_ATTEMPTS`
- `IMAGE_PROVIDER_POLL_BASE`
- `IMAGE_PROVIDER_POLL_TIMEOUT_SECONDS`
- `IMAGE_PROVIDER_POLL_INTERVAL_SECONDS`
- `PUBLIC_BASE_URL`

Final API provider 模型固定为 `gpt-image-2`，不会使用 `IMAGE_MODEL`、`IMAGE_MODEL_IMAGE`、`IMAGE_MODEL_FOR_IMAGE`、`model` 或 `imageModel` 覆盖，也不会 fallback 到 `gpt-image-2-all`、`gpt-image-1`、`dall-e-*`。在当前权威 `toapis` 配置下，文生图 / 无 references 请求和图生图 / 有 references 请求都会提交到 `/v1/images/generations`；图生图通过 `reference_images` 传递结构化引用。缺少 provider key 或 generations endpoint 时，服务返回 `PROVIDER_CONFIG_MISSING` 或配置错误，不会返回假成功。

`PUBLIC_BASE_URL` 用于生成 Generated Image Store 的公网图片 URL。生产环境必须配置 HTTP(S) base URL；服务会去掉尾部 `/` 后拼接 `/api/v1/generated-images/:image_id`。本地开发未配置时才回退到当前本地 host，不在生产环境静默返回 `127.0.0.1`。

## 边界

- 不运行时 import/require `ai-tu/gateway/server.js`。
- `POST /api/v1/image-generations` 不接收图片文件上传，仍只接收 JSON。
- `POST /api/reference-images` 仅作为本地浏览器测试台辅助入口；在当前权威 `真实配置_toapis.md` 下，它会优先把用户选择的参考图上传到配置的公网图床，并返回可放入结构化 `references[].url` 的公网 URL。只有未启用公网图床时才回退到服务本地 Generated Image Store URL。它不是 Final API 验收入口，也不支持 URL-only 生图绕过。
- 不做图床上传或长期参考图托管。
- `references[]` 采用严格结构化协议，不支持只有 URL 的引用对象：`reference_id`、`entity_name`、`entity_type`、`role`、`url` 均为必填字段，且 `reference_id` 在单次请求内必须唯一。
- `entity_type` 与 `role` 必须使用 API 合同中的枚举值；`pattern_reference` 仅兼容映射为 `ornament_reference`。
- 旧请求中的 `usage` 字段可以被接收，但当前版本会忽略它，不参与权重、排序或阻断，也不会在响应中返回。
- `POST /api/v1/prompt-optimizations` 使用独立且更窄的请求 schema；它的 `references[]` 不接收旧 `usage` 字段，也不接收 output、provider、callback、credential、image、base64、final prompt、compiled prompt 或 internal prompt 字段。
- 同一 `entity_name + role` 可以有多张参考图，系统会全部使用；未被 prompt 显式 mention 的参考图也会参与编译和 provider 请求。
- Provider 返回的 URL、base64、data URL 或 binary 生成图会统一标准化为 `images[].url`；其中真实上游 bytes 会通过短期内存 Generated Image Store 暴露为 `/api/v1/generated-images/:image_id`。
- Provider 返回的外部图片 URL 也会经过公网 URL 安全校验；localhost、loopback、link-local、内网或非 HTTP(S) URL 不会进入公共成功响应。
- `callback_url` / `callback.url` 只接收和校验，不执行回调。校验默认拒绝 localhost、loopback、link-local、内网地址和非 HTTP(S) scheme。
- 兼容路由 `/api/image-jobs` 已标记 deprecated；`POST /api/image-jobs` 返回 `410 LEGACY_IMAGE_JOBS_DISABLED`，不会创建任务或直连 provider。`GET /api/image-jobs/:id` 仅保留 deprecated 404 清理语义，不作为 Final API V1.4 验收入口。
- API 响应不返回 final prompt、compiled prompt、enhancement、RAGFlow 状态、fallback 状态、storyboard 路径或 provider payload。
- 专业模板内容由 RAGFlow 知识库命中后返回 JSON enhancement，再由 Prompt Compiler 确定性拼接；Prompt Compiler 本地只保留最小安全骨架、参考绑定、输出说明和通用负向规则。
- RAGFlow 未配置、调用失败、无知识命中或 enhancement 被安全校验丢弃时，服务仍可继续生图，但不会自动补人物四视图、场景 3×3、多机位、道具多角度或故事板左右分区等完整专业模板。
- RAGFlow enhancement 还会按当前 `task_type` 做 consumed-field 校验；只要包含当前任务不消费的字段，整段 enhancement 会被丢弃，避免未使用字段改变模板路径。
- RAGFlow 系统提示词和知识库 seed 见 `docs/ragflow/`；系统提示词只定义 JSON 协议和防幻觉边界，模板正文在 `docs/ragflow/knowledge/`。
- Prompt optimizer 的 RAGFlow URL 只接受服务端配置的固定 `RAGFLOW_BASE_URL` + `RAGFLOW_CHAT_ID` 拼出的 OpenAI-compatible endpoint；请求体不能覆盖 endpoint、provider、model、callback 或 credentials。
- `RAGFLOW_DEPLOYMENT_TIER` 必须严格为 `production`、`staging`、`development` 或 `test`；缺失、`prod`、`stage`、`qa` 或未知值都是配置错误。production/staging 必须使用 HTTPS，并通过 `RAGFLOW_ALLOWED_ORIGINS` 精确允许 scheme/host/effective port，且即使 `RAGFLOW_ALLOW_PRIVATE_ENDPOINTS=true` 也永远拒绝私网端点。development/test 默认拒绝 localhost、loopback、private、link-local、multicast、reserved 地址；只有显式 `RAGFLOW_ALLOW_PRIVATE_ENDPOINTS=true` 才允许 loopback、RFC1918 或 ULA 本地 RAGFlow，metadata/link-local/multicast/reserved 仍拒绝。
- RAGFlow fetch 禁止 userinfo、自动跨域 redirect 和不安全 DNS 解析结果；Authorization 只发给已批准 origin。响应会校验 `Content-Type`、最大字节数、JSON 深度、键数、数组长度、字符串长度和总字符数，任何失败都丢弃 enhancement 并走 deterministic fallback。
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
