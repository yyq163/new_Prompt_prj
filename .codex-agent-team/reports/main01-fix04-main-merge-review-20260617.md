# main01-fix04 Main Merge Review

Status: PASS_EVIDENCE

## Scope

- Branch under repair: main01-fix04.
- Base branch: main01 at b20a386.
- Remote main: origin/main at 751b3013a0526f031c04d08946516d5e46cb6a01.
- Rule: do not merge or push main. This review does not authorize main merge.
- Code map: refreshed with the code-map skill before work; final refresh is still required before any later completion claim.

## Fix04 Repairs

- Provider adapter now keeps reference-backed URL transport on the edits endpoint.
- ai-tu gateway no longer contains legacy job queue, mock upstream, or direct provider submit paths.
- ai-tu gateway now proxies only to the final image backend with a whitelist payload.
- ai-tu gateway public image response now exposes only image URL fields.
- ai-tu gateway and root server both return 410 for legacy image job POST and GET.
- Gateway config page now configures the final image backend proxy and no longer presents mock/provider-direct controls.
- API contract documents now state the root Final API compatibility rule and
  the stricter ai-tu browser gateway reference requirement separately.

## Current Evidence

- PASS_STATIC: npm run check.
- PASS_TESTED: npm test, 139 pass.
- PASS_CONTRACT: AI_TU_RUNTIME_CONFIG_FILE=./真实配置_toapis.md node tests/integration/provider-config.test.js returned REAL_PROVIDER_CONFIG_PRESENT. 旧的 `真实配置.json` 作为历史参考不再作为本轮验收配置源。
- PASS_EVIDENCE: node tests/integration/final-v1-4-evidence.test.js returned FINAL_V1_4_EVIDENCE_SCAN_PASS.
- PASS_TESTED: node api-test/ai-tu/test/v3-6-gateway-contract.test.js, 13 pass.
- PASS_STATIC: git diff --check.
- PASS_STATIC: static scan found old gateway provider-direct/mock symbols only inside negative test assertions, not in ai-tu/gateway/server.js.

## Browser QA

- PASS_BROWSER: Codex Browser opened the ai-tu product page and title matched.
- PASS_BROWSER: text_image page submit used POST /api/v1/image-generations.
- PASS_BROWSER: text_image backend evidence recorded task_type text_image and reference_count 0.
- PASS_BROWSER: no /api/image-jobs call was recorded during the text_image run.
- PASS_BROWSER: returned generated image was requested with GET 200, Content-Type image/png, Cache-Control no-store.
- PASS_BROWSER: image-to-image page submit was rerun with user-assisted local upload; page showed 1 / 16 references before submit.
- PASS_BROWSER: image-to-image used POST /api/v1/image-generations with task_type scene_multiview and reference_count 1.
- PASS_BROWSER: image-to-image run recorded no /api/image-jobs call in the browser QA proxy log.
- PASS_BROWSER: image-to-image returned generated image GET 200, Content-Type image/png, Cache-Control no-store.

## Subagent Review

- Branch Auditor: PASS_BRANCH with EVIDENCE_DEBT_DIFF_SIZE; fix04 required before approval.
- Code Reviewer before fix04: FAIL; findings drove fix04.
- Contract Reviewer before fix04: FAIL; findings drove fix04.
- Provider Integration Reviewer before fix04: FAIL; findings drove fix04.
- Gateway Reviewer before fix04: initial route PASS but noted stale legacy code; fix04 removed it.
- Frontend Reviewer before fix04: static frontend endpoint/text builder mostly PASS; Browser upload remained the critical verification item.
- Generated Store Reviewer: PASS_TESTED.
- Security Reviewer: PASS_SECURITY_WITH_EVIDENCE_DEBT; root legacy GET issue was fixed in fix04 after the review.
- Test Reviewer: PASS_TESTED.
- Code Reviewer after fix04: initially FAIL on spec/gateway optional-reference mismatch; spec was repaired to document the stricter browser gateway rule.
- Contract Reviewer after fix04: initially FAIL on stale legacy GET 404 text and missing browser gateway stricter refs rule; both were repaired in API_CONTRACTS.md and the Final API spec.
- Gateway Reviewer after fix04: PASS_CONTRACT / PASS_SECURITY.
- Provider Integration Reviewer after fix04: PASS.
- Frontend Reviewer after fix04: PASS static.
- Evidence Auditor: PASS_EVIDENCE for the sanitized fix04 evidence captured in this report.
- Main Merge Risk Reviewer: PASS_BRANCH for fix04, with main merge still gated on user approval after main01 integration.
- Browser QA subagent: closed because main session performed Browser QA with user-assisted upload; current Browser QA is PASS_BROWSER.
- Final Integrator: PASS for code, contract, security, tests, Browser, and evidence; main merge approval remains not granted.

## Evidence Debt

- Historical FAIL/BLOCKED/PENDING reports remain audit history and are not rewritten.
- fix03 PASS reports are stale for this branch because fix04 introduces new code changes and fresh evidence requirements.
- Earlier Browser image-to-image automation without user upload remains historical EVIDENCE_DEBT.
- Current Browser text_image and user-assisted image-to-image runs are verified in this report.
- Post-merge review gate and post-merge CodeGraph refresh were completed after merging fix04 back to main01.

## Decision

- PASS_BRANCH: current branch isolation is correct.
- PASS_STATIC: code syntax and diff checks pass.
- PASS_TESTED: required automated tests pass.
- PASS_CONTRACT: provider, gateway, legacy 410, public response, and documented browser gateway reference rules pass by automated tests and static review.
- PASS_SECURITY: no current public leak evidence found in code/tests; reports remain sanitized.
- PASS_BROWSER: text_image and user-assisted image-to-image.
- allowed_to_merge_main_now: no.
- allowed_to_merge_main01_now: yes, after review gate passes on the machine-readable report.
