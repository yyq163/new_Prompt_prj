# Historical Superseded Git Hygiene Reviewer Report

Status: HISTORICAL_SUPERSEDED

This file is not final verdict and must not be used as current post-push status.
It is retained only as an audit marker for an earlier main01 evidence
contradiction repair cycle.

Supersession reason:

- The earlier report evaluated an older `.gitignore` and report-artifact state.
- The current repair cycle restores `.gitignore` to one rule per line and proves
  report, screenshot, tmp, raw, and browser-runtime artifact behavior with
  `git check-ignore -v`.
- Current git-hygiene status is recorded in the newer
  `git-hygiene-reviewer-main01-head-gitignore-report-repair-*` report.

Current gitignore policy:

- `.codex-agent-team/reports/**` is trackable formal evidence.
- `.codex-agent-team/reports/browser-artifacts/` is ignored runtime artifact
  storage.
- `evidence/screenshots/**` is retained and trackable.
- `.codex-agent-team/tmp/`, `raw/`, `logs/`, `state/`, `cache/`, and `ledger/`
  are ignored.
