# Git Hygiene Reviewer Report

- **Branch:** `main01`
- **HEAD:** `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f`
- **Date:** 2026-06-15
- **Reviewer role:** Git Hygiene Reviewer
- **Report file:** `.codex-agent-team/reports/git-hygiene-reviewer-main01-repair-20260615.md`

---

## 1. 当前状态

### 1.1 `.gitignore` 关键条目

当前 `.gitignore` 包含以下相关规则：

```gitignore
runtime-config.json
.env
.env.*
!.env.example
真实配置.json
.codex-agent-team/
.playwright-cli/
evidence/screenshots/
evidence/**/*.trace
evidence/**/*.network
evidence/**/*.har
evidence/**/*.log
```

### 1.2 已跟踪（tracked）文件核查

| 类别 | 已跟踪文件数 | 说明 |
|------|--------------|------|
| `.codex-agent-team/reports/` | 21 | 多个审查报告已被跟踪 |
| `.codex-agent-team/state/` | 2 | `project-state.json`、`task-dag.json` 已被跟踪 |
| `.codex-agent-team/context/` | 1 | 存在 1 个已被跟踪的上下文文件 |
| `evidence/screenshots/` | 0 | 无已跟踪文件 |
| `*.trace` / `*.har` / `*.network.json` | 0 | 无已跟踪文件 |
| `.env` | 0 | 未被跟踪 |
| `runtime-config.json` | 0 | 未被跟踪 |
| `真实配置.json` | 0 | 未被跟踪 |

### 1.3 磁盘上存在的运行时产物

- `.playwright-cli/traces/*.trace`
- `.playwright-cli/traces/*.network`
- `.codex-agent-team/reports/browser-artifacts/`（日志/网络请求文本，共 4 个文件）

这些文件均未被跟踪，且已被 `.gitignore` 正确忽略。

---

## 2. 冲突分析

`.gitignore` 使用了一条 blanket 规则：

```gitignore
.codex-agent-team/
```

这导致：

- `.codex-agent-team/reports/` 与 `.codex-agent-team/state/` 下的已跟踪文件不会自动被移除（Git 对已跟踪文件仍然保留）。
- 但是，**新创建的 reports/state 文件会被默认忽略**，无法通过 `git add` 纳入版本控制，除非使用 `git add -f`。
- 这造成了“远端已跟踪 reports/state，但本地规则却忽略它们”的策略不一致。

因此， hygiene 层面的主要问题是：**忽略规则与已跟踪目录的策略声明冲突**。

---

## 3. 统一策略建议

**采用方案 A：reports / state 正式上云，运行时产物继续 ignore。**

理由：

1. 远端已经跟踪了 `.codex-agent-team/reports/` 和 `.codex-agent-team/state/` 文件，说明项目已将这些报告/状态作为项目知识资产保留。
2. 继续用 blanket `.codex-agent-team/` 会导致新增报告无法被正常 `git add`，容易在后续工作流中造成“被忽略但应提交”的摩擦。
3. 运行时产物（trace、network、har、screenshots、browser-artifacts、.env、runtime-config.json、真实配置.json）仍然应当忽略，避免泄露敏感/大体积/环境相关数据。

---

## 4. 具体 `.gitignore` 修改建议

建议将 `.codex-agent-team/` 的 blanket 规则改为**精确排除**，保留 reports 与 state 的上云能力，同时忽略上下文与运行时产物。

### 推荐替换/新增内容

```gitignore
# -------------------------------------------------
# 敏感配置 / 运行时配置
# -------------------------------------------------
runtime-config.json
.env
.env.*
!.env.example
ai-tu/runtime-config.json
真实配置.json

# -------------------------------------------------
# 索引/工具/运行时输出
# -------------------------------------------------
node_modules/
.DS_Store
.code-index/
.codegraph/
.understand-anything/
.playwright-cli/
output/
test-image/
.server.pid
.server.log
.server-*.pid
.server-*.log
.visual-review*/

# -------------------------------------------------
# Evidence 运行时产物
# -------------------------------------------------
evidence/visual-6task-results.json
evidence/screenshots/
evidence/**/*.trace
evidence/**/*.network
evidence/**/*.network.json
evidence/**/*.har
evidence/**/*.log

# -------------------------------------------------
# Codex Agent Team：reports/state 保留，其他忽略
# -------------------------------------------------
.codex-agent-team/
!.codex-agent-team/reports/
!.codex-agent-team/state/
.codex-agent-team/context/
.codex-agent-team/reports/browser-artifacts/
.codex-agent-team/state/*.jsonl
```

### 修改说明

- `.codex-agent-team/`：仍然默认忽略整个目录。
- `!.codex-agent-team/reports/` 与 `!.codex-agent-team/state/`：在忽略规则之后进行**例外声明**，使这两个子目录可以正常被跟踪/新增。
- `.codex-agent-team/context/`：上下文文件为临时/会话性质，保持忽略；已有的 1 个已跟踪文件不会被删除，但新增文件将默认忽略。
- `.codex-agent-team/reports/browser-artifacts/`：浏览器运行时日志/网络抓取，属于运行产物，应从 reports 中排除。
- `.codex-agent-team/state/*.jsonl`：行式日志/追踪存储为运行时产物，忽略；保留结构化的 `project-state.json`、`task-dag.json`。

---

## 5. 验证

执行了以下检查：

```bash
git diff --check
# exit=0

git diff --cached --check
# exit=0
```

**当前工作树没有 whitespace 冲突，diff-check 通过。**

---

## 6. Verdict

| 项目 | 结果 |
|------|------|
| `.env` / `runtime-config.json` / `真实配置.json` 泄露风险 | ✅ 已通过：均未跟踪 |
| `evidence/screenshots/` 跟踪风险 | ✅ 已通过：无已跟踪文件，且已明确忽略 |
| `*.trace` / `*.har` / `*.network.json` 跟踪风险 | ✅ 已通过：无已跟踪文件，且 evidence 下已明确忽略 |
| `git diff --check` | ✅ 已通过 |
| `.codex-agent-team/` 策略一致性 | ⚠️ 需要修复：建议按方案 A 调整 `.gitignore` |

**总体结论：REPAIR ADVISED（建议按方案 A 修复 `.gitignore` 后继续推进）。**

当前工作树没有 whitespace 错误或已跟踪的敏感文件， hygiene 风险可控；主要修复点是将 `.codex-agent-team/` 的 blanket ignore 改为“reports/state 上云、上下文/运行时产物忽略”的精确规则。

---

*本报告未包含任何敏感文件内容。*
