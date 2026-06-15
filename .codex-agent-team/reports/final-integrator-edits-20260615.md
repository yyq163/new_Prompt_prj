# Final Integrator Review: gpt-image-2 /v1/images/edits

结论：PASS_WITH_IMAGE_EDIT_BLOCKED

本轮专项审查没有把文生图 PASS 冒充为全链路 PASS。报告、浏览器证据和测试结论一致：文生图真实浏览器链路已通过；图生图真实上传已通过；但 `/v1/images/edits` 最终 POST 返回 HTTP 502 `PROMPT_IMAGE_BACKEND_UNAVAILABLE`，没有生成图 URL，没有 mock success，因此 image edit 全链路仍是 BLOCKED。

## 发布判断

- 允许 push main：no
- 允许 commit feature branch：yes

feature branch commit 可以用于保存已验证的协议修复、normalizer 修复、泄露扫描增强、测试和证据；但 main/release 不应放行，除非真实 image edit 浏览器链路重新跑通。

## 证据摘要

- `npm run check`：PASS
- `npm test`：PASS，106/106
- 真实 provider config presence：PASS，未打印敏感配置
- evidence scan：PASS，`FINAL_V1_4_EVIDENCE_SCAN_PASS`
- `git diff --check`：PASS
- `review_gate.py`：PASS
- CodeGraph sync/status：PASS，`pendingChanges=0`
- Browser text image：HTTP 200 succeeded，生成图 GET HTTP 200 `image/png`，`no-store`
- Browser image edit：upload HTTP 200 `image/jpeg`，final POST HTTP 502 `PROMPT_IMAGE_BACKEND_UNAVAILABLE`，无图片 URL，无 mock

## 最小剩余项

1. 在 provider / upstream 侧确认 `/v1/images/edits` 对当前账号、模型和后端是否可用。
2. 若上游提示 multipart 参数不兼容，只最小调整 edits 字段名、filename、MIME 或受支持字段集合。
3. 重新执行真实浏览器 image edit：上传参考图、POST 成功、返回图片 URL、GET 生成图 200。
4. 重新跑 evidence scan、测试、review gate，并更新本专项报告。

## 阻断性遗漏

未发现额外阻断性遗漏。唯一阻断项是 image edit 真实上游链路未成功；因此最终状态不能写成 PASS，只能写成 PASS_WITH_IMAGE_EDIT_BLOCKED。
