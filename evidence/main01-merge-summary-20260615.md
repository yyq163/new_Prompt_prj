# main01 Merge Summary

Date: 2026-06-15

`main01` is a protection branch built from `origin/main` for review only. It
contains the effective code, docs, tests, and sanitized reports from the ragflow,
provider stability, provider edits, and local normalizer preservation work.

Security review rejected the first merge-history attempt because it included
browser trace/network artifacts and screenshot evidence. The pushable rebuild
excludes screenshots, trace/network files, logs, and the append-only evidence
ledger while preserving the functional changes and redacted summary evidence.

Latest redacted browser evidence on `main01` verified text generation after one
transient provider failure and verified image edit success. This branch remains
a protection branch only; `main` is not pushed or merged.
