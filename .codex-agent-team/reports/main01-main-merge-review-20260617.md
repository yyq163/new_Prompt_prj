# main01 Main Merge Review

Status: READY_FOR_MAIN_MERGE_APPROVAL_WITH_EVIDENCE_DEBT

## Scope

- Reviewed branch: `main01`
- Current head: `6a1b4c4`
- Remote `origin/main01`: previously `31ddf5ab296aea607de7aeb8d1865950e9be3df6`, now pending push from current branch
- Remote `origin/main`: `751b3013a0526f031c04d08946516d5e46cb6a01`
- Rule preserved: no merge main, no push main

## Integrated Repairs

- `main01-fix05` was fast-forward merged back into `main01`
- Runtime config defaults now resolve only from explicit `AI_TU_RUNTIME_CONFIG_FILE` or workspace-authoritative `真实配置_toapis.md`
- Deleted repo-side fallback runtime config files
- Root `/api/reference-images` now prefers the configured public image-host path and aligns with public URL rules
- `ai-tu/gateway` preserves root Final API non-2xx public semantics and redacted backend-call summaries
- Image-host upload responses no longer expose `viewer_url` / `delete_url`
- Image-host returned URLs now go through public URL safety checks
- Public error messages no longer expose raw network detail or URL/path detail
- README / BACKEND_DESIGN / API_CONTRACTS reflect the current authoritative `toapis` path

## Automated Verification

- `PASS_STATIC`: `npm run check`
- `PASS_TESTED`: `npm test` -> `141 pass`
- `PASS_CONTRACT`: `AI_TU_RUNTIME_CONFIG_FILE=真实配置_toapis.md node tests/integration/provider-config.test.js` -> `REAL_PROVIDER_CONFIG_PRESENT`
- `PASS_EVIDENCE`: `node tests/integration/final-v1-4-evidence.test.js` -> `FINAL_V1_4_EVIDENCE_SCAN_PASS`
- `PASS_TESTED`: `node api-test/ai-tu/test/v3-6-gateway-contract.test.js` -> `16 pass`
- `PASS_STATIC`: `git diff --check`
- `PASS_STATIC`: code-map skill refreshed at the start and end of this review; final `pendingChanges=0`, `nodeCount=691`, `edgeCount=1721`

## Browser QA

- `PASS_BROWSER`: product page title is `帧界图片生成器极速版`
- `PASS_BROWSER`: page uses `/api/v1/image-generations` and does not use `/api/image-jobs`
- `PASS_BROWSER`: user-assisted local upload from `/Volumes/App_Dev/test-image` completed in the product page, the page showed `1 / 16 参考图`, and the uploaded reference image became the preview
- `PASS_BROWSER`: product page image-reference generation completed successfully and rendered returned image content on the page
- `PASS_BROWSER`: product page text-image generation completed successfully and rendered returned image content on the page

## Evidence Debt

- `EVIDENCE_DEBT`: fresh current-run GET header proof (`GET 200`, `Content-Type image/*`, `Cache-Control: no-store`) is supported by route tests and prior browser instrumentation history, but this exact final rerun did not include a fresh browser-surface header inspector capture
- `EVIDENCE_DEBT`: local `main` remains ahead of `origin/main`; this does not block `main01`, but it remains repository-level branch risk context
- `EVIDENCE_DEBT`: historical `fix04` review artifacts remain in the repo and should be treated as superseded audit history
- `EVIDENCE_DEBT`: independent post-fix05 security re-review was not re-run after the last image-host hardening patch; current security confidence is based on direct code inspection plus green tests

## Decision

- `PASS_BRANCH`
- `PASS_STATIC`
- `PASS_TESTED`
- `PASS_CONTRACT`
- `PASS_BROWSER`
- `PASS_EVIDENCE` with the evidence debt listed above
- `allowed_to_merge_main_now: no`
- `allowed_to_merge_main01_now: yes`
- Conclusion: `main01` can enter the later user-confirmed `main` merge execution task, but only as `READY_FOR_MAIN_MERGE_APPROVAL_WITH_EVIDENCE_DEBT`
