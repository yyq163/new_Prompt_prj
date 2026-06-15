# Security Review: gpt-image-2 edits encoding and bytes fix

结论：FAIL

范围：只读审查，未读取 `真实配置.json`，未修改代码，未回滚任何文件。

## P0

无已确认 P0。

## P1

1. Evidence trace artifact 仍包含内联图片 URI 字面量。
   - 位置：`evidence/screenshots/browser-real-config-rerun-20260615.trace`
   - 影响：即使不是公开接口响应，也违反“证据文件不得保留图片编码原文入口”的要求。只读值级扫描命中 1 处，未展开原文。

2. Report artifact 中存在完整参考图地址字段值。
   - 位置：`.codex-agent-team/reports/premerge-ragflow-knowledge-driven-template.json`
   - 影响：该文件不在本次重点的 `.md` 列表内，但仍位于 reports 目录；若 reports 统一视为可公开审查材料，需要脱敏或迁移。

3. 当前证据测试存在扫描盲区。
   - 位置：`tests/integration/final-v1-4-evidence.test.js`
   - 影响：测试只扫 `evidence` 下的 `json/md/txt`，且跳过 `screenshots` 目录；不会覆盖 `.trace/.network` 浏览器日志，也不会覆盖 `.codex-agent-team/reports`。

## P2

1. 公开响应防护主要依赖字段名拦截和当前路由白名单形状。
   - 当前实现安全边界尚可，但建议补值级断言，防止未来字段改名后绕过。

## 已确认未泄露类别

- 公开成功响应只返回状态、图片 URL 列表、告警列表；未返回上游原始交互、凭据、完整提示词、完整参考图地址、图片编码原文或内部提示词产物。
- 编码/字节图片结果会进入 generated image store，公开响应只给服务生成图片 URL。
- trace-store 仅记录请求 ID、任务类型、模式、计数、状态和 prompt 短哈希；未持久化明文 prompt。
- 错误响应映射为通用错误码和文案，未回显上游正文。
- Fresh verification：`node tests/integration/final-v1-4-evidence.test.js` 通过，输出 `FINAL_V1_4_EVIDENCE_SCAN_PASS`；但该通过结果不覆盖上面的盲区。

## 需要补的 forbidden scan / 测试

- 扩展扫描范围到 `evidence/**/*.{json,md,txt,network,trace,log,har}` 与 `.codex-agent-team/reports/**/*.{md,json}`，二进制图片文件除外。
- 增加值级规则：凭据头和值、会话头和值、密钥形态赋值、内联图片 URI、超长图片编码串、上游原始载荷键、内部提示词产物键、完整参考图地址字段。
- 增加回归测试：上游返回编码图片或字节图片时，公开响应只能包含服务图片 URL。
- 增加回归测试：上游错误体或异常体含敏感类别时，公开错误响应必须保持通用化。
- 增加浏览器证据写入前脱敏步骤，尤其是 `.trace/.network` 文件。
