# Git Hygiene Reviewer Report

**Role:** Git Hygiene Reviewer
**Branch:** main01
**HEAD:** HISTORICAL_SUPERSEDED_HEAD
**Date:** 2026-06-15
**Scope:** `.gitignore` rules for `.codex-agent-team/reports/` and `evidence/screenshots/`

---

## Verdict

**PASS_GIT_HYGIENE**

---

## Review Criteria

1. `.gitignore` must not contain a blanket `.codex-agent-team/` rule.
2. `.gitignore` must contain a rule allowing `.codex-agent-team/reports/**`.
3. `.gitignore` must ignore `.codex-agent-team/context/`, `state/`, `tmp/`, `logs/`, `cache/`, `ledger/`, `raw/`, and `reports/browser-artifacts/`.
4. `.gitignore` must not contain `evidence/screenshots/`.
5. Log / trace / network / HAR ignore patterns may remain.

---

## Findings

### `.gitignore` Inspection

- No literal blanket `.codex-agent-team/` rule is present.
- A scoped `.codex-agent-team/*` rule is used to ignore direct runtime children of the directory, while explicit exception rules keep the directory and its `reports/` subtree tracked:
  - `!.codex-agent-team/`
  - `!.codex-agent-team/reports/`
  - `!.codex-agent-team/reports/**`
- Required ignored subdirectories are all present:
  - `.codex-agent-team/context/`
  - `.codex-agent-team/state/`
  - `.codex-agent-team/tmp/`
  - `.codex-agent-team/logs/`
  - `.codex-agent-team/cache/`
  - `.codex-agent-team/ledger/`
  - `.codex-agent-team/raw/`
  - `.codex-agent-team/reports/browser-artifacts/`
- No `evidence/screenshots/` ignore rule is present.
- Log / trace / network / HAR patterns remain scoped under `evidence/`:
  - `evidence/**/*.trace`
  - `evidence/**/*.network`
  - `evidence/**/*.har`
  - `evidence/**/*.log`

### Validation

| Command | Result |
|---------|--------|
| `git check-ignore -v .codex-agent-team/reports/evidence-auditor-main01-screenshot-policy-20260615.md` | Not ignored; matched exception rule `!.codex-agent-team/reports/**` |
| `git check-ignore -v evidence/screenshots/final-v1-4-contract-after-submit.png` | Not ignored; command exited with status 1 (no matching ignore rule) |
| `git status --short --untracked-files=all .codex-agent-team/reports/` | New / untracked report files are visible to Git |

---

## Conclusion

The `.gitignore` configuration satisfies the screenshot-policy hygiene requirements. `.codex-agent-team/reports/` is properly exposed for tracking, `evidence/screenshots/` is no longer ignored, and the specified runtime artifact directories remain ignored.
