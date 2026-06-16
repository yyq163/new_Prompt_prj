# main01 Codebase Next Stage Review - 2026-06-16

## Verdict

`FAIL_CODE_REVIEW_BLOCKED`

Reason: code/security/contract/test review is repaired and passing, but required browser QA cannot be marked `PASS_BROWSER`: real UI submission returned the public failure message `生图服务暂时不可用，请稍后重试。` with no generated image to GET.

## Branch

- Branch: `main01`
- Starting HEAD: `10f7acfd16b6fe2a2c61cbbf69a7dfec535f1964`
- Push/merge boundary: main was not pushed or merged.

## Subagents

- Code Reviewer: `PASS_STATIC`
- Contract Reviewer: `PASS_CONTRACT`
- Provider Integration Reviewer: `PASS_STATIC`
- Test Reviewer: `EVIDENCE_DEBT`
- Browser QA: `UNVERIFIED` by subagent, lead browser run resulted in `FAIL`
- Evidence Auditor: `PASS_EVIDENCE`
- Security Reviewer: initial `FAIL`, repaired, second review `PASS_SECURITY`
- Final Integrator: `EVIDENCE_DEBT`

## Fix

- `src/core/generated-image-store.js`
  - Replaced shallow magic-byte detection with stricter PNG/JPEG/WEBP structure validation.
  - PNG now requires signature, IHDR first chunk, valid CRC32 for chunks, at least one IDAT, terminal IEND, and no trailing bytes.
  - JPEG now requires SOI/EOI plus SOF and SOS/scan payload structure.
  - WEBP now requires exact RIFF size and non-empty valid VP8/VP8L/VP8X image chunk shape.
- `tests/unit/image-api.test.js`
  - Added fake-header regression coverage for PNG header-only, PNG IHDR/IEND skeleton, JPEG header-only, JPEG SOI/EOI-only, WEBP header-only, and empty VP8.
  - Replaced fake PNG fixture with CRC-correct 1x1 PNG and fixed ArrayBuffer fixture slicing.
- `tests/unit/http-invalid-body.test.js`
  - Replaced fake PNG upload fixture with CRC-correct 1x1 PNG.
- `tests/integration/final-v1-4-evidence.test.js`
  - Replaced fake PNG evidence fixture with CRC-correct 1x1 PNG.

## Verification

- `git fetch origin --prune`: `PASS_STATIC`
- `git checkout main01`: `PASS_STATIC`
- `git pull --ff-only origin main01`: `PASS_STATIC`
- `git ls-remote origin refs/heads/main01`: `PASS_STATIC`, `10f7acfd16b6fe2a2c61cbbf69a7dfec535f1964`
- `git rev-parse main01 origin/main01 origin/main`: `PASS_STATIC`, `10f7acfd16b6fe2a2c61cbbf69a7dfec535f1964`, `10f7acfd16b6fe2a2c61cbbf69a7dfec535f1964`, `751b3013a0526f031c04d08946516d5e46cb6a01`
- `npm run check`: `PASS_STATIC`
- `npm test`: `PASS_TESTED`, 119/119
- `AI_TU_RUNTIME_CONFIG_FILE=[redacted-config] node tests/integration/provider-config.test.js`: `PASS_CONTRACT`, `REAL_PROVIDER_CONFIG_PRESENT`
- `node tests/integration/final-v1-4-evidence.test.js`: `PASS_EVIDENCE`, `FINAL_V1_4_EVIDENCE_SCAN_PASS`
- `git diff --check`: `PASS_STATIC`
- `codegraph sync . && codegraph status --json`: `PASS_STATIC`, `pendingChanges` added 0, modified 0, removed 0
- `review_gate.py --report .codex-agent-team/reports/review-T1-provider-edits-debug-base64-fix.json`: `PASS_EVIDENCE`
- Browser text-image UI submission: `FAIL`, public UI feedback reported backend unavailable and returned no generated image.
- Browser image-reference UI submission: `UNVERIFIED`, skipped because text-image browser gate already failed on live upstream availability.

## EVIDENCE_DEBT

- Historical reports, old hashes, GitHub page cache, and screenshot wording remain superseded historical evidence debt.
- `npm test` does not include integration scripts by package script; this run executed them explicitly.
- `provider-config.test.js` exits 0 on missing real config by design; this run used a local real-provider config and produced `REAL_PROVIDER_CONFIG_PRESENT`.
- Browser failure appears to be live upstream/provider availability; no sensitive runtime artifact was recorded.

## Decision

- `allowed_to_continue_dev`: `no`
- `allowed_to_merge_main`: `no`
- Required next action: repair or restore live provider browser path, then rerun Browser QA text-image and image-reference flows from the Codex browser.
