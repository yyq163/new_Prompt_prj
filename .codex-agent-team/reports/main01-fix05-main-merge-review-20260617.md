# main01-fix05 Main Merge Review

Status: BLOCKED_BROWSER_UNVERIFIED

## Scope

- Review branch: `main01-fix05`
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

## Browser QA

- `PASS_BROWSER` static anchors remain correct in the live page:
  - title `帧界图片生成器极速版`
  - page endpoint is `/api/v1/image-generations`
  - legacy `/api/image-jobs` is not used by the page
- `PASS_BROWSER` upload interaction was completed in the live browser with user assistance:
  - local reference image was uploaded from `/Volumes/App_Dev/test-image`
  - the page showed `1 / 16 参考图`
  - the uploaded reference image became the current preview
- `BLOCKED_BROWSER_UNVERIFIED` remains for final live completion proof:
  - current browser tab entered real `pending_` image-generation state after submit
  - the same browser surface did not settle into a stable completed success state that can be tied unambiguously to the exact current request before this review turn ended
  - trace evidence around the same live window contains both successful and failed image-generation records, so the browser gate cannot be closed from trace-only inference
  - earlier live failures on this branch included `provider_submit/generations/upstream_unreachable` and `provider_normalize/IMAGE_RESULT_EMPTY`

## Review Findings Addressed In Fix05

- Provider config source drift from `真实配置_toapis.md`
- Stale `/v1/images/edits` documentation for the current authoritative `toapis` runtime path
- Root reference upload returning localhost URLs inconsistent with public provider-consumable reference URLs
- Gateway loss of root Final API 4xx/504 semantics

## Remaining Evidence Debt

- `EVIDENCE_DEBT`: local `main` is still ahead of `origin/main`; this does not authorize merge and remains a branch-risk fact for the repository.
- `EVIDENCE_DEBT`: historical `fix04` review artifacts remain in the repo and include superseded blocked/approved naming that should be treated as audit history, not current truth.

## Decision

- `PASS_STATIC`
- `PASS_TESTED`
- `PASS_CONTRACT`
- `PASS_EVIDENCE`
- `FAIL` for merge readiness because Browser QA is not yet conclusively closed
- `allowed_to_merge_main_now: no`
- `allowed_to_merge_main01_now: no`
- Current branch outcome: keep work on `main01-fix05`; do not merge back to `main01` yet
