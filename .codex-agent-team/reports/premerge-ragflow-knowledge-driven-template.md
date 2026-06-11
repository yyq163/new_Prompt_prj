# Pre-Merge Review: RAGFlow Knowledge-Driven Template

Date: 2026-06-11T10:10:00Z

## Status

Current status: PRE_MERGE_REPAIR_PASS_PENDING_FINAL_INTEGRATOR

This report records the merge-before-main review loop after the original feature commit `669859fa8f61b6eb3776a2c21907ac4a5a917804`. The branch is not merged to main yet.

## Subagent Review Loop

- Code Reviewer: initial FAIL. Found internal implementation terms were only checked in `negative_notes`. Repaired with full-tree internal term scanning and tests. Second review PASS.
- Contract Reviewer: initial FAIL. Found RAGFlow could emit known reference IDs/URLs and unknown fields. Repaired with top-level `TYPE_SCHEMAS.RagflowEnhancement` whitelist, reference emission rejection, URL emission rejection, and tests. Second review found URL-like payload gap; repaired `data image`, `file`, and `ftp` URL-like detection. Third review PASS.
- Test Reviewer: initial PASS for accepted SHA, then requested dirty-tree re-review. New tests cover reference emission, URL-like payloads, unknown fields, and internal terms across enhancement fields.
- Browser QA: PASS for required core `text_image` browser flow. Optional local reference upload probe returned 404 on `/api/reference-images`; recorded as non-acceptance evidence and not used to claim reference upload success.
- Security Reviewer: PASS. No sensitive config, raw provider payload, raw response, base64, token, key, or forbidden public fields found.
- Final Integrator: initial FAIL/no-merge because worktree was dirty after repairs. The remaining gate is to commit feature repairs, rerun pre-merge checks on a clean feature HEAD, then merge only if all reviewers remain PASS.

## Repairs After Review

- `src/core/ragflow-enhancement.js`: full-tree internal term scan.
- `src/core/ragflow-enhancement.js`: rejects any `reference_id` / `reference_ids` emitted by RAGFlow.
- `src/core/ragflow-enhancement.js`: rejects emitted URLs and URL-like payloads using common URL schemes and image data payload marker.
- `src/core/ragflow-enhancement.js`: rejects top-level fields outside `TYPE_SCHEMAS.RagflowEnhancement.fields`.
- `tests/unit/image-api.test.js`: adds regression coverage for the above.
- `API_CONTRACTS.md`: contract text now says any RAGFlow-emitted reference IDs/URLs and unknown fields are discarded.

## Pre-Merge Commands On Current Tree

- `npm run check`: pass.
- `npm test`: pass, 81/81.
- `node tests/integration/provider-config.test.js`: pass, real provider config presence confirmed without printing values.
- `node tests/integration/final-v1-4-evidence.test.js`: pass.
- `git diff --check`: pass.
- `review_gate.py --report .codex-agent-team/reports/review-T1-ragflow-knowledge-driven-template.json`: pass.
- `codegraph sync . && codegraph status --json`: pass, pendingChanges added=0 modified=0 removed=0.

## Browser QA Current Tree

- Browser surface: Playwright headed browser with system Chrome.
- Page: http://127.0.0.1:8793/
- Required flow: text_image.
- Final API: POST /api/v1/image-generations.
- HTTP status: 200.
- API status: succeeded.
- Trace: trace_887e122c9c2f4e2cbb.
- Generation: gen_bbea9b38bed64989b8.
- Image URL: http://127.0.0.1:8793/api/v1/generated-images/img_38cc4787b590474993dc837637292a60.
- UI preview: visible, natural size 1824x1024.
- GET image: HTTP 200, Content-Type image/png, Content-Length 1949856, Cache-Control no-store.
- Old /api/image-jobs requests: 0.
- Mock success: false.

Evidence:

- `evidence/premerge-current-tree-browser-summary.json`
- `evidence/premerge-current-tree-browser-report.md`
- `evidence/screenshots/premerge-current-tree-before-submit.png`
- `evidence/screenshots/premerge-current-tree-after-submit-preview.png`

## Merge Rule

Do not merge until the feature repair is committed and pushed, the feature HEAD has a clean worktree, and all pre-merge commands plus final subagent review pass on that exact state.
