# Security Rereview: gpt-image-2 edits encoding and bytes fix

结论：PASS

## 修复项

- 已脱敏旧 browser trace/network artifact 中的完整 generated image URL 和内联图片 scheme。
- 已脱敏 `.codex-agent-team/reports/premerge-ragflow-knowledge-driven-template.json` 中的 URL 字段值。
- 已扩展 `tests/integration/final-v1-4-evidence.test.js` 扫描范围到：
  - `evidence/**/*.{json,md,txt,network,trace,log,har}`
  - `.codex-agent-team/reports/**/*.{md,json}`
- 已新增值级泄露规则，覆盖凭据头和值、key/token/secret 赋值、内联图片 URI、长编码串、provider/raw payload 赋值，以及 evidence/report artifact 中完整 generated image URL。
- 已新增公开失败路径断言：invalid base64 与 wrong magic bytes 只能返回公共错误 envelope，`images` 为空，不含 raw/encoded/internal 字段。

## Fresh Verification

- `node tests/integration/final-v1-4-evidence.test.js`: PASS，输出 `FINAL_V1_4_EVIDENCE_SCAN_PASS`。
- `npm test -- tests/unit/image-api.test.js`: PASS，106/106。

## 剩余风险

- 后续真实浏览器若产生本地捕获文件，仍需执行同一 evidence scan；若新增 artifact 含完整 generated image URL 或 inline data URI，必须脱敏或保持未跟踪后再收口。
