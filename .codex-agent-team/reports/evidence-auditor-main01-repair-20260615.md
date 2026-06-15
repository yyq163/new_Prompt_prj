# Evidence Auditor Report: main01 Protection Branch 2026-06-15

Date: 2026-06-15  
Auditor: Evidence Auditor subagent  
Branch under review: `main01`  
Local `main01` HEAD: `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f`  
`origin/main01` HEAD: `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f` (matches local)  
`origin/main` HEAD: `751b3013a0526f031c04d08946516d5e46cb6a01` (untouched)  
local `main` HEAD: `a77c15fa40f39adaf1c77a6e100f5da354f0b64c` (unpushed)

---

## 1. 审查范围

### 1.1 必审 evidence/ 文件
- `evidence/main01-merge-summary-20260615.md`
- `evidence/final-v1-4-fix-report.md`
- `evidence/final-v1-4-network-summary.json`
- `evidence/network-summary.json`
- `evidence/visual-e2e-report.md`
- `evidence/provider-stability-post-merge-20260615.md`
- `evidence/premerge-current-tree-browser-report.md`（historical 上下文）
- `evidence/premerge-current-tree-browser-summary.json`（historical 上下文）

### 1.2 必审 reports/ 与项目文件
- `CODEGRAPH_REPORT.md`
- `.codex-agent-team/reports/final-integrator-main01-20260615.md`
- `.codex-agent-team/reports/main01-merge-protection-20260615.md`
- `.codex-agent-team/reports/final-integrator-main01-post-push-template-20260615.md`（新增上下文）
- `.codex-agent-team/reports/final-integrator-20260615.md`（historical 上下文）
- `.codex-agent-team/reports/provider-base64-receive-and-browser-rerun-20260615.md`（historical 上下文）
- `.codex-agent-team/reports/git-hygiene-reviewer-main01-repair-20260615.md`（相关审计）
- `.gitignore`

### 1.3 验证动作
- `git rev-parse main01 origin/main01 origin/main`
- `git status --short --untracked-files=all`
- `git diff origin/main01 --stat`
- `git ls-files evidence/screenshots`
- `git ls-files .codex-agent-team`
- `git check-ignore -v evidence/screenshots/* .codex-agent-team/reports/*`
- `git ls-tree -r HEAD -- evidence/ .codex-agent-team/`
- 全局 grep：`ai-tu/evidence/*`、`screenshots_tracked`、`PASS_MAIN_RELEASE`、READY_AFTER_FINAL_VERIFICATION、PASS_MAIN01_PROTECTION_BRANCH_PUSHED、push main、merge main、gateway V3.6 boundary 等关键字。

---

## 2. 发现的不一致清单

### 2.1 Final Integrator 与 Merge Protection 报告状态矛盾（stale pre-push 状态）

| 文件 | 行号 | 内容 |
| --- | --- | --- |
| `.codex-agent-team/reports/final-integrator-main01-20260615.md` | 3 | `Verdict before final push: READY_AFTER_FINAL_VERIFICATION` |
| `.codex-agent-team/reports/main01-merge-protection-20260615.md` | 4 | `FINAL_STATUS: PASS_MAIN01_PROTECTION_BRANCH_PUSHED` |
| `.codex-agent-team/reports/main01-merge-protection-20260615.md` | 68 | `Final Integrator: pre-push ready; final push completed by lead agent after fresh verification.` |
| `.codex-agent-team/reports/main01-merge-protection-20260615.md` | 104–106 | 已记录 `Push branch: main01`、`Push method: explicit git push -u origin main01:main01` |

**矛盾点**：
- `origin/main01` 当前已是 `b296d6d`，与本地 `main01` HEAD 一致，`git diff origin/main01 --stat` 为空，说明 push 已完成且工作区干净。
- `main01-merge-protection-20260615.md` 已声明 `PASS_MAIN01_PROTECTION_BRANCH_PUSHED` 并描述 push 完成。
- 但 `final-integrator-main01-20260615.md` 仍停留在 `READY_AFTER_FINAL_VERIFICATION`，并在第 13–14 行写 “only after final command rerun, commit, explicit push to origin/main01”。该描述与已完成的 push 事实不符，属于 stale pre-push 状态。
- 虽然新增了一份 `final-integrator-main01-post-push-template-20260615.md` 试图把该文件重新归类为 “pre-push historical report”，但模板本身尚未被提升为正式的 post-push 最终报告；且原 `final-integrator-main01-20260615.md` 本身未被修改或标注 historical，因此跟踪文件中的口径不一致仍然存在。

**修复建议**：
1. 将 `final-integrator-main01-20260615.md` 更新为 `PASS_MAIN01_PROTECTION_BRANCH_PUSHED`（若保留为最终报告）；或
2. 在该文件头部添加 `Status: SUPERSEDED_PRE_PUSH_HISTORICAL_REPORT`，明确其已被 `final-integrator-main01-post-push-YYYYMMDD.md` 取代；同时把 post-push 模板实例化为正式报告。

---

### 2.2 `.gitignore` 与实际跟踪 `.codex-agent-team/` 的策略矛盾

| 文件 | 行号 | 内容 |
| --- | --- | --- |
| `.gitignore` | 10 | `.codex-agent-team/` |
| `git ls-files .codex-agent-team` | N/A | 24 个 tracked 文件（reports/ 21 个、context/ 1 个、state/ 2 个） |

**矛盾点**：
- `.gitignore` 明确忽略整个 `.codex-agent-team/` 目录。
- 但实际 `git ls-files .codex-agent-team` 显示 24 个文件已被跟踪并在 `origin/main01` 中存在。
- `git check-ignore -v .codex-agent-team/reports/*` 显示这些文件按 `.gitignore:10` 应被忽略，却因已跟踪而继续留在索引中。
- 这会导致后续新增报告不会被 `git add -A` 自动纳入，需要 `git add -f`，策略上不可持续。

**修复建议**（与 `git-hygiene-reviewer-main01-repair-20260615.md` 一致）：
1. 细化 `.gitignore`，将 `.codex-agent-team/` 替换为：
   ```gitignore
   # Agent runtime/session artifacts — do not track
   .codex-agent-team/state/
   .codex-agent-team/context/
   # Formal review reports — tracked intentionally
   # .codex-agent-team/reports/ is NOT ignored
   ```
2. 运行 `git rm --cached -r .codex-agent-team/state .codex-agent-team/context`，把运行时工件从索引移除（保留本地磁盘文件）。
3. 验证 `git ls-files .codex-agent-team/` 只返回 `reports/*` 文件。

---

## 3. 其他检查点结论

| # | 检查点 | 结论 |
| --- | --- | --- |
| 1 | `screenshots_tracked=false` 与实际 tracked 文件一致 | **PASS**。`evidence/final-v1-4-network-summary.json:25`、`evidence/network-summary.json:6`、`evidence/premerge-current-tree-browser-summary.json:11` 均写 `false`；`.gitignore:23` 忽略 `evidence/screenshots/`；`git ls-files evidence/screenshots` 无输出；本地 PNG 文件被正确忽略。 |
| 2 | Final Integrator 状态与其他报告 PUSHED 口径矛盾 | **发现矛盾**，见 2.1。 |
| 3 | 错误声称 main release PASS 或允许 push/merge main | **未出现**。所有相关文件均声明 “not a release approval for main”、“must not push or merge main”、“Push main: no”、“allowed to merge main: no”。 |
| 4 | 引用不存在的 `ai-tu/evidence/*` 路径 | **未出现**。全局 grep 无匹配；`ai-tu/` 下不存在 `evidence` 目录。 |
| 5 | 混淆 Final API provider normalizer 与 ai-tu gateway V3.6 边界 | **evidence/ 与必审报告中未出现**。`provider-base64-receive-and-browser-rerun-20260615.md:20` 仅提及 v3.6 public error envelope，未声称 gateway 处理 base64/binary/data URL 或 Generated Image Store。`CODEGRAPH_REPORT.md` 对 normalizer 职责描述清晰。注意：`contract-reviewer-main01-repair-20260615.md` 在代码层面提出了 gateway/server.js 的边界问题，但属于代码审计范畴，非 evidence 口径不一致。 |
| 6 | historical evidence 未标 historical | **PASS**。`provider-stability-post-merge-20260615.md`、`premerge-current-tree-browser-report.md`、`premerge-current-tree-browser-summary.json`、`final-integrator-20260615.md`、`provider-base64-receive-and-browser-rerun-20260615.md` 等均标 `SUPERSEDED` 或 historical。 |
| 7 | 当前 browser 成功证据绑定本轮，而非引用旧证据 | **PASS**。当前 evidence 与 reports 均指向 latest `main01` browser rerun；旧的 provider-stability、provider-base64 报告已明确 SUPERSEDED。 |
| 8 | `.codex-agent-team/` 被 `.gitignore` 忽略但 24 个文件仍被远端跟踪 | **发现矛盾**，见 2.2。 |
| 9 | 工作区干净、本地与远端 main01 一致、origin/main 未变 | **PASS**。`git status --short` 为空；`main01 == origin/main01 == b296d6d`；`origin/main == 751b301`。 |

---

## 4. 修复建议汇总

1. **统一 Final Integrator 报告状态**：
   - 选项 A：将 `final-integrator-main01-20260615.md` 的 verdict 更新为 `PASS_MAIN01_PROTECTION_BRANCH_PUSHED`，并补充 push 完成后的 ref 检查结果。
   - 选项 B：在 `final-integrator-main01-20260615.md` 头部标注 `Status: SUPERSEDED_PRE_PUSH_HISTORICAL_REPORT`，并生成正式的 `final-integrator-main01-post-push-20260615.md` 作为权威最终报告。
2. **修复 `.gitignore` 与 `.codex-agent-team/` 跟踪策略冲突**：按 `git-hygiene-reviewer-main01-repair-20260615.md` 的 Option A 细化忽略规则，并 `git rm --cached` state/ 与 context/。
3. **保留 evidence 隐私策略**：继续忽略 screenshots、trace、network、har、log、runtime config、env、真实配置等；保持 `screenshots_tracked=false` 口径。

---

## 5. 最终 Verdict

**NEEDS_REPAIR**

实际分支状态（`main01` 已推送、`main` 未推送、无 tracked screenshots/网络证据/凭据/编码图片）与本轮保护分支目标一致，不存在 BLOCKED 级安全问题。但两份核心审计报告之间存在 stale pre-push 状态矛盾，且 `.gitignore` 与远端跟踪 `.codex-agent-team/` 的实践不一致，需要文档/策略层面的修复后才能视为完全通过。
