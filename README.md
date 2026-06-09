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
- 不做 multipart、图床上传、base64 转 URL、二进制图片处理或临时文件转存。
- API 响应不返回 final prompt、compiled prompt、enhancement、RAGFlow 状态、fallback 状态、storyboard 路径或 provider payload。

## 测试

```bash
npm run check
npm test
node tests/integration/provider-config.test.js
```

集成检查没有真实 provider 环境变量时会报告 `BLOCKED_BY_MISSING_PROVIDER_CONFIG`，这是预期的安全阻断，不代表业务验收通过。
