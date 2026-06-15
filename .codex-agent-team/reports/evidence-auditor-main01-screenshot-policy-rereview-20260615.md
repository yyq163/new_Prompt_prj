# Evidence Auditor Re-Review: main01 Screenshot Policy

**Scope:** Post-repair verification of `evidence/screenshots/` tracking state and screenshot-policy declarations across the repository.

**Branch:** `main01`
**HEAD:** `3a5124085176dc0372fd4fb76c38792b15573eb7`
**Date:** 2026-06-15
**Auditor:** Evidence Auditor subagent

---

## Executive Summary

**Overall hard state: PASS_EVIDENCE**

The previous audit findings have been remediated:

- `evidence/screenshots/` now contains four tracked sanitized PNG files.
- `.gitignore` no longer ignores `evidence/screenshots/`.
- No file in the repository (excluding the previous audit report itself, which documents the prior search patterns) declares `screenshots_tracked=false`, `screenshots_policy=local_only_not_tracked`, or describes the current screenshot strategy as `local-only` / `not tracked`.
- All required evidence files consistently declare the unified policy: `screenshots_policy=sanitized_png_retained`, `screenshots_tracked=true`, `screenshots_ignored=false`.

---

## Verification Matrix

| # | Requirement | Hard State | Evidence |
|---|-------------|------------|----------|
| 1 | `git ls-files evidence/screenshots/` returns exactly 4 PNG files | PASS_EVIDENCE | `browser-qa-main01-image.png`, `browser-qa-main01-text.png`, `final-v1-4-contract-after-submit.png`, `final-v1-4-contract-before-submit.png` |
| 2 | `.gitignore` does not ignore `evidence/screenshots/` | PASS_EVIDENCE | `grep "evidence/screenshots" .gitignore` returned no match; `git check-ignore -v evidence/screenshots/browser-qa-main01-text.png` returned no matching rule |
| 3 | `screenshots_tracked=false` count is 0 (outside audit-pattern descriptions) | PASS_EVIDENCE | Only occurrences are in `evidence-auditor-main01-screenshot-policy-20260615.md` as literal search-pattern descriptions |
| 4 | `screenshots_policy=local_only_not_tracked` count is 0 (outside audit-pattern descriptions) | PASS_EVIDENCE | Only occurrences are in `evidence-auditor-main01-screenshot-policy-20260615.md` as literal search-pattern descriptions |
| 5 | Current screenshot strategy described as `local-only` / `not tracked` count is 0 | PASS_EVIDENCE | Remaining `local-only` / `not tracked` references are either about trace/network captures (not screenshots) or explicitly historical |
| 6 | Required files consistently declare `screenshots_policy=sanitized_png_retained`, `screenshots_tracked=true`, `screenshots_ignored=false` | PASS_EVIDENCE | See File-by-File Consistency section below |

---

## File-by-File Consistency

| File | Declared Policy | Hard State |
|------|-----------------|------------|
| `CODEGRAPH_REPORT.md` | "sanitized screenshot PNG files under `evidence/screenshots/`. Screenshot files are retained and tracked" | PASS_EVIDENCE |
| `evidence/network-summary.json` | `"screenshots_tracked": true`, `"screenshots_policy": "sanitized_png_retained"` | PASS_EVIDENCE |
| `evidence/final-v1-4-network-summary.json` | `"screenshots_tracked": true`, `"screenshots_policy": "sanitized_png_retained"` | PASS_EVIDENCE |
| `evidence/visual-e2e-report.md` | "Screenshots are retained as sanitized PNG files and tracked on `main01`"; trace/network captures remain local-only (acceptable, not screenshot strategy) | PASS_EVIDENCE |
| `evidence/final-v1-4-fix-report.md` | "Screenshots are retained as sanitized PNG files and tracked." | PASS_EVIDENCE |
| `evidence/provider-stability-post-merge-20260615.md` | `screenshots_policy: sanitized_png_retained`, `screenshots_tracked: true`, `screenshots_ignored: false` | PASS_EVIDENCE |
| `evidence/main01-merge-summary-20260615.md` | "Confirmed `screenshots_tracked=true` and `evidence/screenshots/` is tracked; screenshots are retained as sanitized PNG files" | PASS_EVIDENCE |

---

## Remaining `local-only` / `not tracked` References

The full-repository search still surfaces a small number of `local-only` / `not tracked` phrases. All are acceptable:

1. `evidence/visual-e2e-report.md` line 7 and `.codex-agent-team/reports/browser-qa-edits-20260615.md` line 34 describe **trace files and network captures** as local-only / not tracked. This is correct: only screenshots are retained and tracked; runtime artifacts such as traces and network captures remain excluded from Git.
2. `.codex-agent-team/reports/final-integrator-main01-20260615.md` line 16 is explicitly prefixed with `HISTORICAL_PRE_PUSH_REPORT` and states "Screenshot policy at the time was local-only; current policy is `sanitized_png_retained` with screenshots tracked." This is a valid historical contrast, not a current policy declaration.
3. `.codex-agent-team/reports/evidence-auditor-main01-screenshot-policy-20260615.md` contains the prior audit's search-pattern descriptions and findings. It is part of the audit trail and is not asserting the current policy.

No remaining file describes the **current** screenshot strategy as `local-only`, `not tracked`, `untracked`, or `ignored`.

---

## Git Index Verification

```text
$ git ls-files evidence/screenshots/
evidence/screenshots/browser-qa-main01-image.png
evidence/screenshots/browser-qa-main01-text.png
evidence/screenshots/final-v1-4-contract-after-submit.png
evidence/screenshots/final-v1-4-contract-before-submit.png

$ git check-ignore -v evidence/screenshots/browser-qa-main01-text.png
<no output>  # not ignored
```

The four screenshot files are staged/tracked in the Git index. `evidence/screenshots/` is not matched by any `.gitignore` rule.

---

## Conclusion

**PASS_EVIDENCE** — The screenshot-policy contradictions identified in the previous Evidence Auditor run have been resolved. The repository now presents a consistent, tracked, sanitized-PNG screenshot policy on `main01` at HEAD `3a5124085176dc0372fd4fb76c38792b15573eb7`.
