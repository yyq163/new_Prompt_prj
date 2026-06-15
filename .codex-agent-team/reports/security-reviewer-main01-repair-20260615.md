# Security Reviewer Report: main01 Repair Scan

- **Branch:** main01
- **HEAD:** b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f
- **Reviewer:** Security Reviewer subagent
- **Date:** 2026-06-15
- **Scope:** Full repository scan for sensitive information leakage (excludes `node_modules/`, `.git/`, build outputs).
- **Constraint:** No real configuration contents, key/token values, base64 strings, raw responses, or complete prompts/reference URLs are printed in this report. Only risk categories and existence flags are recorded.

## 扫描范围

- 已跟踪文件：`git ls-files` 列出的全部 85 个文件，重点检查：
  - `.codex-agent-team/reports/`
  - `.codex-agent-team/context/`
  - `.codex-agent-team/state/`
  - `evidence/`（包括 `*.json`、`*.md`）
  - `src/`（源码）
  - `tests/`（测试）
  - `docs/`、`ai-tu/`、根目录 Markdown 与配置示例
- 本地工作区敏感文件存在性与忽略状态：
  - `.env`、`.env.*`
  - `runtime-config.json`
  - `ai-tu/runtime-config.json`
  - `ai-tu/runtime-config.example.json`
  - `真实配置.json`
  - `.server.pid`、`.server.log`
- 敏感模式：
  - `Authorization`、`Bearer`、`apiKey`、`api-key`、`token`、`secret`、`password`、`Cookie`
  - `b64_json`、data URI image、长 base64 串（≥80 字符）
  - `final_prompt`、`compiled_prompt`、`provider_payload`、`raw_provider_payload`、`raw_response`
- 证据产物跟踪状态：
  - `evidence/screenshots/` 本地 PNG 文件
  - `evidence/**/*.trace`、`evidence/**/*.network`、`evidence/**/*.har`、`evidence/**/*.log`
  - `.playwright-cli/` 日志与截图
  - `.codex-agent-team/reports/browser-artifacts/`

## 检查方法

```bash
git branch --show-current
git rev-parse HEAD
git status --ignored --short
git ls-files | wc -l
git check-ignore -v .env .server.log .server.pid "真实配置.json" ai-tu/runtime-config.json ai-tu/runtime-config.example.json runtime-config.json evidence/screenshots/*.png .playwright-cli/*.log

# 已跟踪文件敏感模式扫描
git grep -n -iE 'Authorization|Bearer|apiKey|api-key|apikey|token|secret|password|Cookie' --
# scan for inline image data URIs and b64_json fields
git grep -n -E '[A-Za-z0-9+/]{80,}={0,2}' --
git grep -n -iE 'final_prompt|compiled_prompt|provider_payload|raw_provider|raw_response' --
git grep -n -E 'sk-[A-Za-z0-9]{20,}|ragflow-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9_\-]{10,}' --

# 跟踪状态检查
git ls-tree HEAD -- evidence/screenshots/
git ls-files | grep -iE '\.(png|trace|har|network|log)$'
git ls-files .codex-agent-team/ | wc -l
```

## 发现清单

| # | 文件 / 位置 | 风险等级 | 说明 |
|---|------------|---------|------|
| 1 | `.codex-agent-team/`（24 个已跟踪文件） | **MEDIUM** | `.gitignore:10` 已声明忽略整个 `.codex-agent-team/` 目录，但仍有 24 个文件处于已跟踪状态。内容扫描未发现真实凭证或 base64，但该目录包含 agent 报告、上下文、状态等运行期产物，与忽略策略冲突，存在未来误提交敏感运行信息的风险。 |
| 2 | `.env`、`真实配置.json`、`ai-tu/runtime-config.json` | **INFO（本地风险，未跟踪）** | 本地存在并包含真实 API key / token 值，但均已被 `.gitignore` 覆盖，`git ls-files` 中无对应记录。未进入跟踪历史，不构成仓库泄露。 |
| 3 | `ai-tu/runtime-config.example.json` | **INFO（本地风险，未跟踪）** | 本地示例配置文件存在且包含真实 API key 值，与“示例”命名预期不符。该文件被 `.gitignore:15` 忽略，未跟踪。建议清理示例文件中的真实密钥或删除该文件，避免本地误用。 |
| 4 | `src/providers/ai-tu-provider-adapter.js`、`src/routes/prompt-optimizations.js`、`ai-tu/gateway/server.js` | INFO | 代码中使用 `Auth header: Bearer ${credential.key}` 等模板变量方式构造请求头，无硬编码真实 key。 |
| 5 | `tests/unit/image-api.test.js`、`tests/unit/ai-tu-prompt-optimizer.test.js`、`tests/integration/final-v1-4-evidence.test.js` | INFO | 测试代码使用 `"test-key"`、样例 base64（来自 `samplePngBase64()` 等 fixture）、正则规则检查禁止词。无真实凭证，且测试断言验证响应中不会出现 `final_prompt`、`compiled_prompt`、`b64_json`、data URI image、Authorization 等敏感内容。 |
| 6 | `ai-tu/ai-image-generator.html:7` | INFO | 存在 `data URI image/svg+xml,...` 内联 favicon，长度很短，非真实 provider 图像数据。 |
| 7 | 源码与测试中对 `b64_json`、`base64`、`image_base64`、`data_url`、`final_prompt`、`compiled_prompt`、`provider_payload` 的引用 | INFO | 均为字段名、禁止词列表或处理逻辑，未携带真实 provider 返回的图像 payload 或完整 prompt。 |
| 8 | `evidence/screenshots/*.png`（2 个本地文件） | SAFE | 本地存在 2 个 PNG 截图，但未被跟踪；`.gitignore:23` 已覆盖 `evidence/screenshots/`。与 `evidence/final-v1-4-network-summary.json`、`evidence/network-summary.json`、`evidence/premerge-current-tree-browser-summary.json` 中 `screenshots_tracked: false` 的声明一致。 |
| 9 | `evidence/**/*.trace`、`evidence/**/*.network`、`evidence/**/*.har`、`evidence/**/*.log` | SAFE | 无本地文件；`.gitignore:24-27` 已覆盖。network summary 中 `raw_provider_bodies_recorded: false` 与实际情况一致。 |
| 10 | `.playwright-cli/` | SAFE | 本地存在 console log、page YAML、trace 资源等运行产物，均未被跟踪；`.gitignore:11` 已覆盖。 |
| 11 | `.codex-agent-team/reports/browser-artifacts/` | SAFE | 本地存在 4 个日志/请求记录文件，均未被跟踪；因父目录 `.codex-agent-team/` 已在 `.gitignore` 中，无需额外规则。 |
| 12 | `evidence/*.json`、`evidence/*.md`、已跟踪报告文件 | SAFE | 内容均为脱敏摘要、契约说明、测试结论，未发现完整 prompt、完整 reference URL、真实 generated-image URL、base64 编码图像、凭证值。 |

### 已跟踪的 `.codex-agent-team/` 文件完整列表

```
.codex-agent-team/context/T1-provider-edits-debug-base64-fix.md
.codex-agent-team/reports/branch-auditor-main01-20260615.md
.codex-agent-team/reports/browser-qa-edits-20260615.md
.codex-agent-team/reports/contract-review-main01-final-api-ragflow-provider-store-20260615.md
.codex-agent-team/reports/edits-protocol-reviewer-20260615.md
.codex-agent-team/reports/final-integrator-edits-20260615.md
.codex-agent-team/reports/final-integrator-main01-20260615.md
.codex-agent-team/reports/main01-merge-protection-20260615.md
.codex-agent-team/reports/merge-reviewer-main01-20260615.md
.codex-agent-team/reports/normalizer-reviewer-20260615.md
.codex-agent-team/reports/premerge-ragflow-knowledge-driven-template.json
.codex-agent-team/reports/premerge-ragflow-knowledge-driven-template.md
.codex-agent-team/reports/provider-config-reviewer-edits-20260615.md
.codex-agent-team/reports/provider-edits-debug-20260615.md
.codex-agent-team/reports/review-T1-provider-edits-debug-base64-fix.json
.codex-agent-team/reports/review-T1-ragflow-knowledge-driven-template.json
.codex-agent-team/reports/review-T1-ragflow-knowledge-driven-template.md
.codex-agent-team/reports/security-reviewer-edits-rereview-20260615.md
.codex-agent-team/reports/security-reviewer-main01-rereview-20260615.md
.codex-agent-team/reports/subagent-loop-T1-ragflow-knowledge-driven-template.md
.codex-agent-team/reports/test-reviewer-edits-20260615.md
.codex-agent-team/reports/worktree-auditor-main01-20260615.md
.codex-agent-team/state/project-state.json
.codex-agent-team/state/task-dag.json
```

## 修复建议

1. **解决 `.codex-agent-team/` 跟踪与忽略策略冲突（主要修复项）**
   - 如果这些 agent 产物确实不应进入仓库历史，执行：
     ```bash
     git rm --cached -r .codex-agent-team/
     ```
   - 如果这些文件是有意保留的审计轨迹，则应从 `.gitignore` 中移除 `.codex-agent-team/` 行，避免忽略策略与实际跟踪状态矛盾。

2. **清理本地示例配置文件**
   - 检查 `ai-tu/runtime-config.example.json` 是否确实需要包含真实 API key 值。建议将示例文件中的真实密钥替换为占位符（如 `"YOUR_API_KEY"`）或删除该文件，防止本地误用或被意外复制提交。

3. **CI / pre-commit 加固**
   - 增加扫描脚本，阻止以下模式进入跟踪历史：
     - `*.png`、`*.trace`、`*.har`、`*.network`、`.server.log`、`.server.pid`、`.env`、`真实配置.json`、`.playwright-cli/`、`.codex-agent-team/`
     - 真实 key 模式：`sk-...`、`ragflow-...`、`Bearer <token>`、长度 ≥80 的 base64 串等。

4. **本报告位置说明**
   - 本报告写入 `.codex-agent-team/reports/security-reviewer-main01-repair-20260615.md`，位于被忽略的目录下，默认不会被跟踪；如需作为审计记录保留，请显式 `git add -f`。

## 最终 Verdict

**NEEDS_REPAIR**

未发现真实敏感值（Authorization/Bearer token、API key、Cookie、长 base64、完整 prompt/reference URL、raw provider payload）泄露到已跟踪文件中；本地敏感配置和运行时产物均已被 `.gitignore` 正确忽略且未跟踪；`evidence/screenshots/` 未跟踪，与 `screenshots_tracked=false` 策略一致。但是，`.codex-agent-team/` 目录下有 24 个文件仍处于已跟踪状态，与 `.gitignore` 的忽略意图冲突，属于安全策略层面的不一致，需要修复后再判定为 PASS。
