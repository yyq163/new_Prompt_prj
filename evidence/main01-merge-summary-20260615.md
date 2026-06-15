# main01 Merge Summary

Date: 2026-06-15

`main01` is a protection branch built from `origin/main` for review only. It
contains the effective code, docs, tests, and sanitized reports from the ragflow,
provider stability, provider edits, and local normalizer preservation work.

This summary was refreshed during the evidence-chain security contradiction
repair cycle. The repair cycle:

- Confirmed `screenshots_tracked=true` and `evidence/screenshots/` is tracked;
  screenshots are retained as sanitized PNG files in the repository.
- Confirmed `.codex-agent-team/reports/` is tracked as a controlled evidence
  chain; runtime artifacts under `.codex-agent-team/` remain ignored.
- Added dedicated poll/status URL Authorization security regression tests in
  `tests/unit/provider-poll-url-security.test.js`.
- Re-ran unit tests, integration tests, evidence scan, review gate, and real
  browser acceptance for both text generation and image edit.
- Kept `origin/main` untouched and did not push or merge `main`.

Latest redacted browser evidence on `main01` verified text generation and image
edit success. This branch remains a protection branch only; `main` is not pushed
or merged.
