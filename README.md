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

如果 ai-tu 配置只提供 `imageModel` 和 key，服务会使用 ai-tu 默认 JSON generations endpoint，并以 `imageModel` 作为 model。缺少 provider model 或 key 时，服务返回 `PROVIDER_CONFIG_MISSING`，不会返回假成功。

## 边界

- 不运行时 import/require `ai-tu/gateway/server.js`。
- 不接收图片文件上传。
- 不做 multipart、图床上传、参考图上传或本地文件转存。
- `references[]` 采用严格结构化协议，不支持只有 URL 的引用对象：`reference_id`、`entity_name`、`entity_type`、`role`、`url` 均为必填字段，且 `reference_id` 在单次请求内必须唯一。
- `entity_type` 与 `role` 必须使用 API 合同中的枚举值；`pattern_reference` 仅兼容映射为 `ornament_reference`。
- 旧请求中的 `usage` 字段可以被接收，但当前版本会忽略它，不参与权重、排序或阻断，也不会在响应中返回。
- 同一 `entity_name + role` 可以有多张参考图，系统会全部使用；未被 prompt 显式 mention 的参考图也会参与编译和 provider 请求。
- Provider 返回的 URL、base64、data URL 或 binary 生成图会统一标准化为 `images[].url`；其中真实上游 bytes 会通过短期内存 Generated Image Store 暴露为 `/api/v1/generated-images/:image_id`。
- `callback_url` / `callback.url` 只接收和校验，不执行回调。
- API 响应不返回 final prompt、compiled prompt、enhancement、RAGFlow 状态、fallback 状态、storyboard 路径或 provider payload。
- 当前阶段不宣称完成工业级高并发能力；现状见 `docs/concurrency-status.md`。

## 测试

```bash
npm run check
npm test
node tests/integration/provider-config.test.js
```

集成检查没有真实 provider 环境变量时会报告 `BLOCKED_BY_MISSING_PROVIDER_CONFIG`，这是预期的安全阻断，不代表业务验收通过。
