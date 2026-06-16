# Historical Superseded Evidence Auditor Report

Status: HISTORICAL_SUPERSEDED

This file is not final verdict and must not be used as current post-push status.
It is retained only as an audit marker for an earlier main01 evidence
contradiction repair cycle.

Supersession reason:

- The earlier report discussed unresolved untracked report artifacts and staged
  repair status from a previous cycle.
- The current repair cycle requires fresh checks for stale HEAD wording,
  screenshot policy, report trackability, runtime artifact ignores, and final
  remote HEAD source.
- Current evidence-audit status is recorded in the newer
  `evidence-auditor-main01-head-gitignore-report-repair-*` report.

Current evidence policy:

- `screenshots_policy=sanitized_png_retained`.
- `screenshots_tracked=true`.
- `screenshots_ignored=false`.
- `.codex-agent-team/reports/**` is formal evidence and trackable except the
  explicit browser runtime artifact subdirectory.
- `.codex-agent-team` runtime directories and raw browser/runtime artifacts are
  ignored.
