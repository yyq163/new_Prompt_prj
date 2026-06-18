# main01-fix08 Prompt Optimizer Security Debt

## Status

`PASS_ZERO_SECURITY_DEBT_PROMPT_OPTIMIZER` with Evidence Auditor PASS and Final Integrator PASS.

Browser QA: `UNVERIFIED_NOT_APPLICABLE` because no UI source code changed.

## Scope

Changed prompt optimizer backend/API hardening for:

- `/api/v1/prompt-optimizations`
- strict request schema and reference validation
- RAGFlow endpoint, tier, DNS, redirect, header, timeout, byte, JSON, and output
  safety
- deterministic fallback
- public response allowlist and recursive forbidden scan
- isolation from image providers, Generated Image Store, callbacks, and image
  URLs
- shared URL sanitizer regressions used by image API
- docs and tests

No `ai-tu` frontend or gateway source files were modified. Static frontend and
gateway assertions were moved out of prompt optimizer tests into
`tests/unit/ai-tu-frontend-contract.test.js`.

## Key Repairs

- Added an independent `PromptOptimizationRequest` schema and strict unknown
  field rejection.
- Rejected callback/provider/model/api_key/token/internal/final/compiled
  prompt/provider payload/images/base64/data_url fields before optimizer logic.
- Hardened RAGFlow base URL policy, production HTTPS/allowed origin policy,
  dev/test explicit private endpoint opt-in, DNS result validation, pinned
  lookup, manual redirects, and approved-origin Authorization handling.
- Added RAGFlow response resource limits for timeout, bytes, content-type, JSON
  depth, key count, array length, string length, and total characters.
- Added task-specific RAGFlow consumed-field validation so unconsumed but
  globally allowed fields cannot change template paths.
- Hardened legacy `RAGFLOW_ENHANCEMENT_URL` helper with URL validation, pinned
  lookup, manual redirect, content-type, stream byte limit, and schema tightening.
- Removed `input_analysis` and `storyboard_processing` from allowed
  `RagflowEnhancement` fields.
- Rejected URL userinfo and fixed IPv4-mapped IPv6 `::ffff:0.0.0.0` handling in
  shared URL security.
- Added tests for schema injection, strict references, RAGFlow URL/tier/DNS/
  redirect/timeout/oversize/deep JSON/wrong content-type/unsafe output, public
  response gate negative cases, isolation, and image API regression.

## Verification

- `npm run check`: PASS
- `npm test`: PASS, 158/158
- `node --test tests/unit/ai-tu-prompt-optimizer.test.js`: PASS, 30/30
- `node --test tests/unit/http-invalid-body.test.js`: PASS, 5/5
- `node --test tests/unit/image-api.test.js`: PASS, 105/105
- `node --test tests/unit/ai-tu-frontend-contract.test.js`: PASS, 9/9
- `node tests/integration/final-v1-4-evidence.test.js`: PASS,
  `FINAL_V1_4_EVIDENCE_SCAN_PASS`
- `npm run test:provider-config`: PASS, `REAL_PROVIDER_CONFIG_PRESENT`
- `git diff --check`: PASS
- `gitleaks`: `UNVERIFIED_NOT_INSTALLED`
- fallback high-signal secret `rg` scan: PASS, no matches

## Subagents

- Branch Auditor: PASS, P0/P1/P2/P3 empty
- Code Reviewer: PASS, P0/P1/P2/P3 empty
- Prompt Optimizer Reviewer: PASS, P0/P1/P2/P3 empty
- API Schema Reviewer: PASS, P0/P1/P2/P3 empty
- RAGFlow Security Reviewer: PASS, P0/P1/P2/P3 empty
- SSRF/Credential Reviewer: PASS, P0/P1/P2/P3 empty
- Security Reviewer: PASS, P0/P1/P2/P3 empty
- Test Reviewer: PASS, P0/P1/P2/P3 empty
- Evidence Auditor: PASS, P0/P1/P2/P3 empty
- Final Integrator: PASS, P0/P1/P2/P3 empty

Evidence Auditor and Final Integrator both passed with P0/P1/P2/P3 empty. The branch is ready to commit, push, merge into `main01`, rerun post-merge gates, and push `origin/main01`.
