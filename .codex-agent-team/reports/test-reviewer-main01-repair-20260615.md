# Test Reviewer Report — main01 repair

**Branch:** `main01`  
**HEAD:** `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f`  
**Review date:** 2026-06-15  
**Reviewer subagent:** Test Reviewer  
**Scope:** `tests/unit/*.test.js` and `tests/integration/*.test.js`

---

## 1. Test inventory

| File | Type | Framework | Approx. test count | Note |
|---|---|---|---|---|
| `tests/unit/ai-tu-prompt-optimizer.test.js` | unit | `node:test` | 21 | Prompt optimizer, RAGFlow integration, task_type/generation_mode separation, reference leakage guards, gateway/static checks |
| `tests/unit/http-invalid-body.test.js` | unit | `node:test` | 3 | HTTP body size/JSON validation, V1.4 route acceptance, reference image upload |
| `tests/unit/image-api.test.js` | unit | `node:test` | 85 | Core image API, provider adapter, normalizer, poll URL security, routing regression, references, callbacks |
| `tests/unit/provider-poll-url-security.test.js` | unit | `node:test` | 9 | Dedicated provider poll URL Authorization safety tests |
| `tests/integration/provider-config.test.js` | integration | standalone assertions | 1 script | Verifies real provider config shape and required fields |
| `tests/integration/final-v1-4-evidence.test.js` | integration | standalone assertions | 1 script | Scans public responses and artifact reports for forbidden leak patterns |
| **Total `node:test` assertions** | — | — | **118** | Meets the `>= 109` requirement |

---

## 2. Coverage assessment

| Required coverage | Present | Evidence in test files |
|---|---|---|
| Total tests >= 109 | ✅ | `npm test` reports `tests 118 / pass 118` |
| Provider poll URL Authorization safety direct test | ✅ | `tests/unit/provider-poll-url-security.test.js` (9 dedicated tests) plus `tests/unit/image-api.test.js` lines 1433-1597: async poll with `Authorization` header observed, allowlist rejects evil/local/private/malformed URLs before fetch, public response does not leak URL/header/key |
| 文生图 / 图生图 routing regression tests | ✅ | `tests/unit/image-api.test.js` lines 1599-1806: text/no-reference → generations endpoint; reference-backed tasks → edits endpoint; model forced to `gpt-image-2`; endpoint derived from references not `generation_mode` |
| Provider normalizer URL/base64/data URL/binary conversion tests | ✅ | `tests/unit/image-api.test.js` lines 787-1071: `b64_json`, `base64`, `image_base64`, `data_url`, binary buffer, typed arrays, direct HTTP binary response, metadata-heavy variants all converted to local `/api/v1/generated-images/` URLs |
| RAGFlow boundary tests | ✅ | `tests/unit/ai-tu-prompt-optimizer.test.js` lines 182-276; `tests/unit/image-api.test.js` lines 560-695: enhancement participation, invalid/field-summary/unauthorized content discarded, missing enhancement still succeeds, `final_prompt`/`compiled_prompt`/URL/reference_id/binding decision leaks rejected |
| Prompt Compiler boundary tests | ✅ | `tests/unit/ai-tu-prompt-optimizer.test.js` lines 63-317; `tests/unit/image-api.test.js` lines 444-557: task_type vs generation_mode, fallback does not invent multiview templates, knowledge-driven enhancements appended, storyboard path preservation |
| References boundary tests | ✅ | `tests/unit/image-api.test.js` lines 245-787: role/entity enums, duplicate IDs, multiple same-entity refs, unmentioned refs, missing ref warnings, URL-only reference rejection, structured reference upload URL flow |
| Callback boundary tests | ✅ | `tests/unit/image-api.test.js` lines 70-130; `tests/integration/final-v1-4-evidence.test.js` lines 89-138: callback accepted but not executed/exposed, private/unsafe callback URLs rejected |
| No `mock provider success` / `runMockUpstream` usage | ✅ | Grep across `tests/` returned no matches for `runMockUpstream`, `mockProviderSuccess`, or equivalent names |
| No fallback to old `/api/image-jobs` | ✅ | No `fetch("/api/image-jobs")` in frontend or tests; `ai-tu-prompt-optimizer.test.js` line 54 asserts `doesNotMatch` for `/api/image-jobs`; legacy API only tested for deprecation headers (`tests/unit/image-api.test.js` line 239) |

---

## 3. Run results

### 3.1 `npm run check`

```
> final-image-generation-api@0.1.0 check
> node --check server.js && node --check src/routes/image-generations.js && ...

(exit 0)
```

**Result:** PASS — syntax check succeeds for all listed entry points and modules.

### 3.2 `npm test`

```
> final-image-generation-api@0.1.0 test
> node --test tests/unit/*.test.js

ℹ tests 118
ℹ pass 118
ℹ fail 0
ℹ duration_ms ~6187
```

**Result:** PASS — all 118 unit tests pass.

### 3.3 `AI_TU_RUNTIME_CONFIG_FILE=<real-config> node tests/integration/provider-config.test.js`

The environment already contains a valid provider configuration. Running the integration script both with and without an explicit `AI_TU_RUNTIME_CONFIG_FILE` produced:

```
REAL_PROVIDER_CONFIG_PRESENT
```

**Result:** PASS — required provider fields (generations endpoint, edits endpoint, model, key) are present and normalized. No real key/token values are reproduced in this report.

### 3.4 `node tests/integration/final-v1-4-evidence.test.js`

First observed failure:

```
AssertionError [ERR_ASSERTION]: .codex-agent-team/reports/poll-url-security-reviewer-main01-repair-20260615.md contains forbidden pattern /\bAuthorization\b\s*[:=]\s*(?!\[REDACTED\])/i
```

Additional pre-existing reports that also fail the same scanner (test stops at the first match, so only one is reported per run):

```
FORBIDDEN .codex-agent-team/reports/security-reviewer-main01-repair-20260615.md :: literal data-URL prefix in prose
FORBIDDEN .codex-agent-team/reports/security-reviewer-main01-repair-20260615.md :: literal Authorization header token followed by colon in prose
ARTIFACT  .codex-agent-team/reports/browser-qa-main01-repair-20260615.md :: /https?:\/\/[^\s"')\]}]+\/api\/v1\/generated-images\/img_[a-f0-9]{32}/i
```

**Result:** FAIL — the evidence scanner rejects pre-existing artifact reports. The poll-URL and security review reports use the literal Authorization header token followed by a colon and/or literal data-URL prefix in descriptive prose; the browser QA report records real local generated-image URLs produced during browser automation. None of these are leaked upstream credentials, but the scanner patterns treat them as forbidden artifacts.

---

## 4. Failures

| # | Test / command | Failure | Root cause / assessment | Severity |
|---|---|---|---|---|
| 1 | `tests/integration/final-v1-4-evidence.test.js` | Scanner rejects `.codex-agent-team/reports/poll-url-security-reviewer-main01-repair-20260615.md` for an unredacted Authorization header token pattern | The evidence test forbids the substring `Authorization` followed by `:` or `=` unless followed by `[REDACTED]`. The existing poll-URL security report uses that substring in explanatory tables (e.g. describing where the upstream request carries an Authorization header). This is a scanner false positive against documentation prose, not a real secret leak. | Medium — blocks the evidence suite from passing and may block CI; the underlying code/test coverage is correct |
| 2 | `tests/integration/final-v1-4-evidence.test.js` | Scanner rejects `.codex-agent-team/reports/security-reviewer-main01-repair-20260615.md` for unredacted data-URL prefix and Authorization header token patterns | The security review report contains concept references to data URLs and the Authorization header token with a colon in prose. These are descriptive, not real secrets. | Medium — same as above |
| 3 | `tests/integration/final-v1-4-evidence.test.js` | Scanner rejects `.codex-agent-team/reports/browser-qa-main01-repair-20260615.md` for recording a local generated-image URL | The artifact-only scanner forbids URLs matching `/api/v1/generated-images/img_<hex>` in reports. The browser QA report records the actual local URL returned by the Final API during a real browser run. This is a local-only artifact URL, not an upstream secret, but the scanner does not allow it in `.codex-agent-team/reports/`. | Medium — same as above |

### 4.1 Recommendations for the failures

1. **Short-term:** Update the offending reports:
   - In the poll-URL security report and the security review report, replace any literal Authorization header token followed by a colon or equals sign with `[REDACTED]` (e.g. `Authorization [REDACTED]`).
   - In the security review report, redact or escape any literal data-URL prefix examples.
   - In the browser QA report, either omit local generated-image URLs, replace them with `<REDACTED_URL>`, or move the report outside `.codex-agent-team/reports/` if it is intended to retain raw local artifacts.
2. **Long-term:** Consider softening the evidence scanner so that concept references like `the Authorization header` or placeholder forms describing a Bearer token are not treated as credential leaks, while still catching real header values. Any such change must be tested to ensure it does not weaken the leak-prevention goal.

---

## 5. Verdict

**CONDITIONAL PASS with one integration failure.**

- All 118 unit tests pass and cover the required security, routing, normalizer, RAGFlow, Prompt Compiler, reference, and callback boundaries.
- No forbidden `runMockUpstream` / `mock provider success` patterns are present.
- No fallback to `/api/image-jobs` is present; the legacy endpoint is only exercised for deprecation headers.
- Real provider config validation passes.
- The `final-v1-4-evidence.test.js` integration script fails because of pre-existing artifact reports (poll-URL security report, security review report, and browser QA report) that the scanner treats as containing forbidden patterns. The failures are artifact-scanning false positives, not indications of missing test coverage or real secret leaks. Once the reports are redacted or excluded, the evidence suite is expected to pass.
