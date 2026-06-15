# Evidence Auditor Report: Screenshot Policy Uniformity

- **Role:** Evidence Auditor
- **Branch:** `main01`
- **HEAD:** `HISTORICAL_SUPERSEDED_HEAD`
- **Date:** 2026-06-15
- **Scope:** Verify that screenshot policy is uniformly declared as `screenshots_policy=sanitized_png_retained`, `screenshots_tracked=true`, `screenshots_ignored=false` across evidence files and reports.

---

## Target State

All reviewed artifacts must reflect the unified screenshot policy:

- `screenshots_policy`: `sanitized_png_retained`
- `screenshots_tracked`: `true`
- `screenshots_ignored`: `false`

Prohibited expressions when applied to screenshot policy must be absent:

- `screenshots tracked false pattern`: count must be `0`
- `historical superseded screenshot policy pattern`: count must be `0`
- `ignored runtime` used for screenshot strategy: count must be `0`
- `ignored` used for screenshot strategy: count must be `0`

---

## Audit Scope

Reviewed files:

- `CODEGRAPH_REPORT.md`
- `evidence/network-summary.json`
- `evidence/final-v1-4-network-summary.json`
- `evidence/visual-e2e-report.md`
- `evidence/final-v1-4-fix-report.md`
- `evidence/provider-stability-post-merge-20260615.md`
- `evidence/main01-merge-summary-20260615.md`
- `evidence/premerge-current-tree-browser-summary.json`
- `evidence/premerge-current-tree-browser-report.md`
- `.codex-agent-team/reports/*`

Repository-wide scan excluded `.git/` and `node_modules/`.

---

## Findings

### 1. Git Tracking State

| Check | Command | Result |
|---|---|---|
| Files under `evidence/screenshots/` | `find evidence/screenshots -type f` | 4 files present |
| Tracked screenshot files | `git ls-files evidence/screenshots/` | **0 files tracked** |
| Untracked screenshot files | `git ls-files --others --exclude-standard evidence/screenshots/` | 4 files untracked |
| Git status | `git status --short evidence/screenshots/` | `?? evidence/screenshots/` |

The working tree contains screenshot files, but none are in the Git index. This contradicts the declared `screenshots_tracked=true` state.

### 2. `.gitignore` Check

| Check | Result |
|---|---|
| Rule `evidence/screenshots/` present | **No** — removed in current `.gitignore` diff |
| Trace/network/HAR/log patterns remain scoped | Yes (`evidence/**/*.trace`, `evidence/**/*.network`, `evidence/**/*.har`, `evidence/**/*.log`) |
| `git check-ignore -v evidence/screenshots/*.png` | No matching ignore rule |

`.gitignore` is consistent with `screenshots_ignored=false`. However, because the files are untracked, the effective repository state does not satisfy the `screenshots_tracked=true` requirement.

### 3. File Consistency Review

Files declaring the correct current policy (`sanitized_png_retained`, `screenshots_tracked=true`, `screenshots_ignored=false`):

- `evidence/network-summary.json`
- `evidence/final-v1-4-network-summary.json`
- `evidence/premerge-current-tree-browser-summary.json`
- `evidence/provider-stability-post-merge-20260615.md`
- `evidence/main01-merge-summary-20260615.md`
- `evidence/visual-e2e-report.md`
- `evidence/final-v1-4-fix-report.md`
- `CODEGRAPH_REPORT.md`
- `.codex-agent-team/reports/screenshot-security-reviewer-main01-20260615.md`
- `.codex-agent-team/reports/browser-qa-20260615.md`
- `.codex-agent-team/reports/provider-poll-url-subagent-summary-20260615.md`
- `.codex-agent-team/reports/git-hygiene-reviewer-main01-screenshot-policy-20260615.md`

These declarations are internally consistent but **disagree with the actual Git index**, where zero screenshot files are tracked.

### 4. Forbidden Pattern Scan

| Pattern | Required Count | Actual Count | Notes |
|---|---|---|---|
| `screenshots tracked false pattern` | 0 | 0 | PASS |
| `historical superseded screenshot policy pattern` | 0 | 0 | PASS |
| `ignored runtime` used for screenshot strategy | 0 | **4** | See violations below |
| `ignored` used for screenshot strategy | 0 | **4** | See violations below |

Violations (phrases applied to screenshot/browser-capture policy, not to trace/network artifacts):

- `.codex-agent-team/reports/provider-base64-receive-and-browser-rerun-20260615.md` lines 44, 53: `Screenshot: retained and tracked as sanitized evidence on main01.` (2 occurrences)
- `.codex-agent-team/reports/final-integrator-main01-20260615.md` line 16: `Screenshot policy at the time: retained and tracked as sanitized evidence.`
- `.codex-agent-team/reports/final-integrator-main01-post-repair-template-20260615.md` line 81: `Screenshot/browser-capture policy: retained and tracked as sanitized evidence.`
- `.codex-agent-team/reports/browser-qa-edits-20260615.md` line 33: `Sanitized PNG screenshots are intentionally retained and tracked as evidence; browser trace and network captures are ignored runtime artifacts.`

The following occurrences are **not** counted as screenshot-policy violations because they describe trace/network artifacts or branch mechanics, not screenshot policy:

- `evidence/visual-e2e-report.md` line 7: `Trace files and network captures remain ignored runtime and are ignored.`
- `.codex-agent-team/reports/branch-auditor-main01-20260615.md` line 9: merge-based branch kept `ignored runtime`.

---

## Verdict

**FAIL_EVIDENCE**

The repository declares a unified `screenshots_policy=sanitized_png_retained` / `screenshots_tracked=true` / `screenshots_ignored=false` policy in its evidence files, but the actual Git index does not contain any screenshot files under `evidence/screenshots/`. In addition, several reports still describe screenshots as `ignored runtime`, `ignored`, `untracked`, or `ignored`, which conflicts with the target unified policy.

---

## Specific Inconsistencies

1. **Untracked screenshots contradict tracked policy**
   - `evidence/screenshots/` contains 4 PNG files.
   - `git ls-files evidence/screenshots/` returns 0 tracked files.
   - This contradicts `screenshots_tracked=true` declared in `evidence/network-summary.json`, `evidence/final-v1-4-network-summary.json`, `evidence/premerge-current-tree-browser-summary.json`, `evidence/provider-stability-post-merge-20260615.md`, `evidence/main01-merge-summary-20260615.md`, `evidence/visual-e2e-report.md`, `evidence/final-v1-4-fix-report.md`, `CODEGRAPH_REPORT.md`, and `.codex-agent-team/reports/screenshot-security-reviewer-main01-20260615.md`.

2. **Stale policy wording in reports**
   - `.codex-agent-team/reports/provider-base64-receive-and-browser-rerun-20260615.md` states screenshots are `retained and tracked as sanitized evidence on main01`.
   - `.codex-agent-team/reports/final-integrator-main01-20260615.md` states the screenshot policy was `retained and tracked as sanitized evidence`.
   - `.codex-agent-team/reports/final-integrator-main01-post-repair-template-20260615.md` lists the default template policy as `retained and tracked as sanitized evidence`.
   - `.codex-agent-team/reports/browser-qa-edits-20260615.md` states `No screenshots or browser captures are tracked`.

3. **Historical reports retained as audit trail**
   - `.codex-agent-team/reports/final-integrator-main01-post-repair-20260615.md`, `.codex-agent-team/reports/security-reviewer-main01-repair-20260615.md`, and `.codex-agent-team/reports/evidence-auditor-main01-repair-20260615.md` are marked HISTORICAL and describe the prior `HISTORICAL_SUPERSEDED_SCREENSHOT_POLICY` policy in the context of the repair cycle. They are acceptable as audit trail but contribute to the overall count of old-policy references.

---

## Recommendations

1. **Add screenshot files to the Git index** to satisfy `screenshots_tracked=true`:
   ```bash
   git add evidence/screenshots/
   git commit -m "main01: track sanitized screenshot evidence"
   git push origin main01
   ```
2. **Archive or update stale reports** that still describe screenshots as `ignored runtime`, `ignored`, `untracked`, or `ignored`. If retained as audit trail, ensure each file begins with an explicit `HISTORICAL` marker and does not present the old policy as current.
3. **Re-run this audit** after staging/committing screenshots and cleaning up stale report wording.

---

## Audit Trail

- Branch `main01` matches `origin/main01` at `HISTORICAL_SUPERSEDED_HEAD`.
- Local `main` (`a77c15fa40f39adaf1c77a6e100f5da354f0b64c`) remains unpushed and untouched.
- No credentials, keys, tokens, runtime config content, raw provider bodies, complete generated-image links, or base64 payloads are recorded in this report.
