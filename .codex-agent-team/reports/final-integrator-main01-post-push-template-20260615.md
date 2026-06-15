# Historical Final Integrator Template: main01 post-repair

Status: HISTORICAL_SUPERSEDED_TEMPLATE
Date: 2026-06-15

This file is retained only as audit history. It is not a current template, not a
current final verdict, and not a source of current branch-head evidence.

The earlier draft template contained fill-in markers and branch-head examples
from an older repair cycle. Those details have been removed because tracked
reports must not carry unresolved placeholders or stale heads as if they were
current post-repair evidence.

Current repair rules are recorded in:

- `.codex-agent-team/reports/final-integrator-main01-evidence-contradiction-repair-20260616-001549.md`
- `.codex-agent-team/reports/final-integrator-main01-evidence-contradiction-repair-20260616.md`

Current branch hashes must be verified only from final command output after the
repair commit and push:

- `git rev-parse main01`
- `git rev-parse origin/main01`
- `git ls-remote origin main01`
- `git rev-parse origin/main`

Current screenshot policy:

- screenshots_policy: sanitized_png_retained
- screenshots_tracked: true
- screenshots_ignored: false

Sanitized PNG screenshots are intentionally retained and tracked as evidence.
Runtime browser artifacts under `.codex-agent-team/reports/browser-artifacts/`
remain ignored.

Push policy:

- Push `origin/main01` only.
- Do not push or merge `main`.
- Do not force push.
- This historical template does not authorize a main release.
