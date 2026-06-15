# main01 Merge Protection Report

Date: 2026-06-15
FINAL_STATUS: PASS_MAIN01_PROTECTION_BRANCH_PUSHED

## Scope

This run creates a protection branch named `main01` for future total review. It
must not push or merge `main`. The latest browser rerun verified both text and
image edit on `main01`, but this is still protection-branch evidence only.

## Branch Summary

| Ref | Head | Included in main01 safe rebuild | Notes |
| --- | --- | --- | --- |
| `origin/main` | `751b3013a0526f031c04d08946516d5e46cb6a01` | base | remote main untouched |
| local `main` | `a77c15fa40f39adaf1c77a6e100f5da354f0b64c` | yes | ahead of origin/main by ragflow merge |
| `codex/ragflow-knowledge-driven-template` | `4ababd5c9a9d5eb87d9380defd976a7b629e5576` | yes | content restored from unsafe integration snapshot |
| `codex/provider-stability-post-merge` | `ea80cfe5b6c9b66720c829ced0ace321c6d59533` | yes | content restored from unsafe integration snapshot |
| `codex/provider-edits-debug-base64-fix` | `e924310d494cda940506a056be940b4654f95e28` | yes | content restored from unsafe integration snapshot |
| `codex/local-uncommitted-provider-normalizer-fix` | `af31603fa2c33b5634a077f0d9ee92aea4e9a087` | yes | preserves the two local uncommitted files |
| `merge-candidate/provider-stability-20260615-main-a77c15f` | `a77c15fa40f39adaf1c77a6e100f5da354f0b64c` | yes | same head as local main |
| unsafe local backup | `3b4f2da3b84001c82e007d09c54b807142a116aa` | not pushed | preserved locally only due evidence security risk |

## Merge Method

An initial merge-based `main01` integration was created and reviewed. Security
review failed because that history included browser trace/network artifacts,
real-config-named screenshots, and full evidence ledger artifacts. To avoid
pushing sensitive evidence history, the unsafe branch was preserved locally as
`backup/main01-unsafe-before-security-redaction-20260615172134`, and the pushable
protection branch was rebuilt from `origin/main` by restoring only code,
contracts, tests, sanitized reports, and text evidence summaries.

Excluded from the pushable rebuild:

- browser screenshot artifacts
- browser capture artifacts
- `.codex-agent-team/state/evidence-ledger.jsonl`
- browser/server logs and ignored runtime artifacts
- local runtime config and env files

## Local Uncommitted Changes

The previously uncommitted changes were committed to
`codex/local-uncommitted-provider-normalizer-fix` as `af31603` and are included:

- `src/providers/provider-result-normalizer.js`
- `tests/unit/image-api.test.js`

They preserve the behavior where invalid image candidates do not discard a
separate valid provider image result, while public responses remain URL-only.

## Conflict Resolution

No textual merge conflict was present in the unsafe integration. The safe rebuild
used controlled checkout from the unsafe snapshot and excluded risky evidence
artifacts rather than conflict resolution.

## Subagent Reports

- Branch Auditor: PASS; all named local and remote branches accounted for.
- Worktree Auditor: PASS; local normalizer/test changes included and worktree clean.
- Merge Reviewer: PASS; unsafe merge DAG covered all target sources with no conflicts.
- Contract Reviewer: PASS with noted risks; sanitized report is stored separately.
- Security Reviewer: initial FAIL; safe rebuild removed the risky artifacts and requires re-review before push.
- Security Reviewer re-review: PASS for the safe rebuild staged index.
- Final Integrator: pre-push ready; final push completed by lead agent after fresh verification.

## Critical Features Preserved

- RAGFlow knowledge-driven template: yes.
- Prompt Compiler no hardcoded professional Final API templates: yes.
- Provider model only `gpt-image-2`: yes.
- Text endpoint `/v1/images/generations`: yes.
- Reference endpoint `/v1/images/edits`: yes.
- Poll URL credential safety: yes.
- `data[0].image` and `data[0].result`: yes.
- Binary/direct image response: yes.
- Generated Image Store no-store: yes.
- Public response URL-only: yes.
- Structured references: yes.
- Callback not executed: yes.
- No mock success: yes.

## Known Blocked

Earlier `/v1/images/edits` browser evidence observed backend-unavailable
failure. The latest `main01` real browser rerun superseded it with HTTP 200
public success and generated-image GET no-store. This protection branch is not a
mainline PASS and must not be used to push or merge `main`.

## Security Decision

- Sensitive config committed: no.
- Env/runtime config committed: no.
- Raw provider payload committed: no known pushed artifact.
- Long encoded image payload committed: no known pushed text artifact.
- Key or token committed: no known pushed artifact.
- Push main allowed: no.

## Push Evidence

- Push branch: `main01`.
- Push main: no.
- Push method: explicit `git push -u origin main01:main01`.
- Final branch purpose: protection and future total review only.
