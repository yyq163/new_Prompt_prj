# AI-tu

单文件图片生成器和本地生图网关。

## 启动

```bash
npm start
```

默认地址：

- 生成器：`http://127.0.0.1:8787/`
- 配置页：`http://127.0.0.1:8787/config`
- 配置页别名：`http://127.0.0.1:8787/peizhi`

## 配置

运行时配置写入 `runtime-config.json`，该文件已加入 `.gitignore`，不会进入仓库。

配置页可以编辑：

- 上游完整端点
- API Key
- 默认模型
- 单 key / 多 key
- 并发数
- 参考图图床模式、imgbb 上传端点和 imgbb API Key
- live / mock 模式

图生图参考图默认先上传到 imgbb，再把返回的公网 `image_url` 交给上游图生图接口。`local` 图床模式只建议本地调试使用。
