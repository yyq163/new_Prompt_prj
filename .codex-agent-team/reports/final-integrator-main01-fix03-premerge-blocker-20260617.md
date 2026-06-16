# main01-fix03 Pre-Merge Blocker Final Report

Status: FIX_BRANCH_REPAIRED_AND_MERGED_TO_MAIN01_PENDING

## Scope

- Branch: main01-fix03, created from main01.
- Task: repair remaining ai-tu gateway V3.6 pre-merge blockers.
- Code map: refreshed before work with code-map skill; CodeGraph initialized and clean at start.
- Context capsule: .codex-agent-team/context/main01-fix03-premerge-blocker.md.

## Resolved

- Text-to-image builder now always sends task_type text_image with references empty, independent of the image task type selector.
- The frontend final generation request builders no longer send legacy generation knobs in the top-level body.
- Gateway validation now rejects references on text_image and requires at least one valid absolute http or https reference for every non-text task type.
- Gateway backend forwarding now constructs a whitelist payload only: task type, prompt, references, reference policy, and output contract fields.
- Gateway response remains public-whitelisted, legacy image jobs remain disabled, and fix02 no-mock, no-provider-direct, self-reference, not-configured, invalid-response protections remain intact.
- Evidence auditor gap was closed by adding a positive http image URL proxy case alongside https.

## Tests

- PASS: node api-test/ai-tu/test/v3-6-gateway-contract.test.js, 13 pass.
- PASS: node --test tests/unit/ai-tu-prompt-optimizer.test.js, 23 pass.
- PASS: npm run check.
- PASS: npm test, 135 pass.
- PASS: AI_TU_RUNTIME_CONFIG_FILE=.codex-agent-team/state/runtime-config.toapis.json node tests/integration/provider-config.test.js.
- PASS: node tests/integration/final-v1-4-evidence.test.js.
- PASS: git diff --check.

## Browser QA

- PASS: Product page title was 帧界图片生成器极速版.
- PASS: Text-to-image in in-app Browser submitted through /api/v1/image-generations while the image task type selector remained scene_multiview.
- PASS: Text-to-image trace trace_bb42a68a8a984a5388 recorded task_type text_image, reference_count 0, image_count 1, status succeeded.
- PASS: Text-to-image result image img_e1ff06d6312244389ed8f602b2bf6881 returned GET 200, image/png, Cache-Control no-store.
- PASS_BROWSER_USER_ASSISTED_UPLOAD: User uploaded one reference image through the in-app Browser product page.
- PASS: Image-to-image page showed 1 / 16 reference images, task_type image_reference, and a real rendered reference image.
- PASS: Image-to-image submitted through /api/v1/image-generations and did not call /api/image-jobs.
- PASS: Image-to-image trace trace_db05d7c182e04916aa recorded task_type image_reference, reference_count 1, image_count 1, status succeeded.
- PASS: Image-to-image result image img_ee5d31b534364b19a2f0ce593a0ea3f8 returned GET 200, image/png, Cache-Control no-store.
- Note: local Browser QA used ALLOW_LOCAL_REFERENCE_URLS=true only on the local final API process so the provider could fetch the locally uploaded reference image; the production default remains reject-local.

## Security

- PASS: No credential value was written to report artifacts.
- PASS: Evidence scan passed before report creation; this report intentionally avoids full generated image URLs and secret-bearing raw artifacts.
- PASS: Gateway continues to reject self-referential backend config and does not expose backend internals in public response.

## Review Roles

- Code and contract review: PASS, no high or critical findings.
- Security review: PASS, no high or critical findings.
- Test and evidence review: PASS after adding the missing http positive proxy test and completing Browser QA.
- Final integrator: PASS pending final review gate, end code-map refresh, merge to main01, and post-merge total gate.

## Merge State

- fix branch: main01-fix03.
- allowed_to_merge_main_now: no, until review gate, end code-map refresh, merge, post-merge gate, and push complete in this run.
