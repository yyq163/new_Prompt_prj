# main01-fix05 Main Merge Review

Status: FAIL_MAIN_MERGE_REVIEW_BLOCKED

## Scope

- Review branch: `main01-fix05`
- Review commit: `2e98d54 fix main01 merge gate config and gateway blockers`
- Base branch: `main01` at `31ddf5ab296aea607de7aeb8d1865950e9be3df6`
- Remote main: `origin/main` at `751b3013a0526f031c04d08946516d5e46cb6a01`
- Rule: no merge main, no push main, no force push

## Fix05 Repairs

- Default runtime config now resolves only from explicit `AI_TU_RUNTIME_CONFIG_FILE` or workspace-authoritative `真实配置_toapis.md`.
- Deleted repo-side fallback config files `ai-tu/runtime-config.example.json` and `ai-tu/gateway/.env.example`.
- Root `/api/reference-images` now aligns with the current authoritative config and prefers configured public image-host upload instead of always returning localhost Generated Image Store URLs.
- Root `/api/reference-images` and `/api/v1/image-generations` now share the same public URL base rules.
- `ai-tu/gateway` now preserves root Final API non-2xx public semantics instead of flattening every backend non-2xx result to `502`.
- Gateway now preserves safe `backend_call_summary` on propagated timeout/error responses.
- README, BACKEND_DESIGN, and API_CONTRACTS were updated to remove stale default-config and `/v1/images/edits` claims for the current authoritative `toapis` path.

## Automated Verification

- `PASS_STATIC`: `npm run check`
- `PASS_TESTED`: `npm test` -> `141 pass`
- `PASS_CONTRACT`: `AI_TU_RUNTIME_CONFIG_FILE=真实配置_toapis.md node tests/integration/provider-config.test.js` -> `REAL_PROVIDER_CONFIG_PRESENT`
- `PASS_EVIDENCE`: `node tests/integration/final-v1-4-evidence.test.js` -> `FINAL_V1_4_EVIDENCE_SCAN_PASS`
- `PASS_TESTED`: `node api-test/ai-tu/test/v3-6-gateway-contract.test.js` -> `16 pass`
- `PASS_STATIC`: `git diff --check`
- `PASS_STATIC`: code-map skill refreshed again after `fix05` commit; `pendingChanges=0`, `nodeCount=691`, `edgeCount=1721`

## Browser QA

- `PASS_BROWSER` static anchors remain correct in the live page:
  - title `帧界图片生成器极速版`
  - page endpoint is `/api/v1/image-generations`
  - legacy `/api/image-jobs` is not used by the page
- `PASS_BROWSER` upload interaction was completed in the live browser with user assistance:
  - local reference image was uploaded from `/Volumes/App_Dev/test-image`
  - the page showed `1 / 16 参考图`
  - the uploaded reference image became the current preview
- `PASS_EVIDENCE` live service trace recorded fresh success during this repair window:
  - `text_image` success with `image_count=1`
  - `image_reference` success with `reference_count=1` and `image_count=1`
- `FAIL` remains for Browser merge-gate completion:
  - the current browser tab still showed `pending_` instead of settling into a clear completed-success surface tied to the same live request
  - the browser rerun still does not give a fresh, directly observed GET-200 / `Content-Type:image/*` / `Cache-Control:no-store` proof from the product page itself
  - same-session evidence still contains intermittent upstream 502 / invalid-response records, so the browser gate is not clean enough for merge approval

## Review Findings Addressed In Fix05

- Provider config source drift from `真实配置_toapis.md`
- Stale `/v1/images/edits` documentation for the current authoritative `toapis` runtime path
- Root reference upload returning localhost URLs inconsistent with public provider-consumable reference URLs
- Gateway loss of root Final API 4xx/504 semantics

## Remaining Evidence Debt

- `EVIDENCE_DEBT`: local `main` is still ahead of `origin/main`; this does not authorize merge and remains a branch-risk fact for the repository.
- `EVIDENCE_DEBT`: historical `fix04` review artifacts remain in the repo and include superseded blocked/approved naming that should be treated as audit history, not current truth.
- `EVIDENCE_DEBT`: current browser rerun proves real live submission and upload interaction, but not a fully self-consistent product-page completion proof.

## Decision

- `PASS_STATIC`
- `PASS_TESTED`
- `PASS_CONTRACT`
- `PASS_EVIDENCE`
- `FAIL` for merge readiness because Browser QA is not yet conclusively closed on the product page
- `allowed_to_merge_main_now: no`
- `allowed_to_merge_main01_now: no`
- Current branch outcome: keep work on `main01-fix05`; do not merge back to `main01` yet
