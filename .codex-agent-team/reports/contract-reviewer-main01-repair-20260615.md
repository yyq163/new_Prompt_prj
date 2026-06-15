# Contract Review Report — main01 repair

**Reviewer role:** Contract Reviewer  
**Repository:** `/Volumes/App_Dev/new_Prompt_prj`  
**Branch:** `main01`  
**HEAD:** `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f`  
**Date:** 2026-06-15  

## Scope

Review whether the listed Final API / provider / RAGFlow / Prompt Compiler / reference / callback / public-response / ai-tu gateway V3.6 contracts are established in `src/`, `tests/`, `docs/`, and `API_CONTRACTS.md`. Also scan for the prohibited statement *“binary/direct image provider responses are not accepted”* as a Final API contract.

## Contract Checklist

| # | Contract Item | Verdict | Primary Evidence |
|---|---|---|---|
| 1 | **Final API endpoints:** `POST /api/v1/image-generations`, `GET /api/v1/generated-images/:image_id` | ✅ PASS | `server.js` lines 44–78; `src/routes/image-generations.js`; `src/core/generated-image-response.js` |
| 2 | **Provider model & routing:** fixed `gpt-image-2`; text/no refs → `/v1/images/generations`; refs → `/v1/images/edits`; no fallback model | ✅ PASS | `src/providers/ai-tu-provider-adapter.js` lines 19, 30–43, 622–623; `tests/unit/image-api.test.js` lines 1599–1806 |
| 3 | **Provider normalizer:** accepts URL / base64 / `b64_json` / data URL / `data[0].image` / `data[0].result` / binary / direct image HTTP response; stores in Generated Image Store; public response `images[].url` only | ✅ PASS | `src/providers/provider-result-normalizer.js` lines 12–117, 275–314; `tests/unit/image-api.test.js` lines 787–1091 |
| 4 | **RAGFlow:** JSON enhancement only; no `final_prompt` / `compiled_prompt` / `reference_id` / URL / binding decision; no primary/auxiliary/weight/priority | ✅ PASS | `src/core/ragflow-enhancement.js` lines 3–65; `src/core/runtime.js` `TYPE_SCHEMAS.RagflowEnhancement`; `tests/unit/image-api.test.js` lines 594–695 |
| 5 | **Prompt Compiler:** no unconditional hardcoded professional templates; minimal fallback | ✅ PASS | `src/core/prompt-compiler.js` lines 82–165; `tests/unit/image-api.test.js` lines 444–558 |
| 6 | **References:** structured required fields; no URL-only; no primary/auxiliary/usage weighting | ✅ PASS | `src/core/runtime.js` `normalizeReference` lines 165–180; `src/core/reference-binding.js` lines 51–82, 127–137; `tests/unit/image-api.test.js` lines 52–406, 568–577 |
| 7 | **Callback:** validate only, do not execute | ✅ PASS | `src/core/runtime.js` `normalizeCallbackUrl` lines 247–260; `src/routes/image-generations.js` no callback execution; `tests/unit/image-api.test.js` lines 70–130 |
| 8 | **Public response:** forbidden-fields scanner not weakened | ✅ PASS | `src/core/runtime.js` `FORBIDDEN_PUBLIC_FIELDS` lines 45–69, `assertNoForbiddenPublicFields` lines 262–273; `tests/unit/image-api.test.js` lines 173–186 |
| 9 | **ai-tu gateway V3.6:** product UI, not API console; validate/forward/whitelist only; backend must return `http(s) images[].url`; gateway does not run Generated Image Store or convert base64/binary | ⚠️ PARTIAL — legacy gateway artifact remains | Active runtime (`server.js`) conforms, but `ai-tu/gateway/server.js` still contains non-conforming V3.6 behavior. See Finding 1 below. |

## Findings

### Prohibited statement scan

No file in `src/`, `tests/`, `docs/`, or `API_CONTRACTS.md` contains the statement *“binary/direct image provider responses are not accepted”* or any equivalent wording. The normalizer tests and spec explicitly state that binary/direct HTTP image responses **are** accepted and converted to Generated Image Store URLs.

### PASS findings (runtime)

- **Final API response shape:** `handleImageGeneration` returns only `{ status, images, warnings }` and each image contains only `{ url }`. Error envelopes follow the V3.6 `{ status, error, images, warnings }` shape.
- **Provider model fixation:** `generateWithAiTuProvider` hardcodes `FIXED_IMAGE_MODEL = "gpt-image-2"` and `sanitizeProviderConfig` ignores configured `model` / `imageModel` values that differ. Negative tests confirm `gpt-image-2-all`, `gpt-image-1`, and `dall-e-*` never reach the provider payload.
- **Provider endpoint selection:** derived from reference presence, not `task_type` or `generation_mode`. The adapter posts to `/v1/images/generations` for text/no-reference and `/v1/images/edits` for reference-backed requests.
- **Normalizer coverage:** `normalizeProviderImageObject` handles raw strings (URL or data URI), `b64_json`, `base64`, `image_base64`, `data_url`, `item.image`, `item.result`, `bytes`/`buffer`/`binary`/`data`, Buffer/ArrayBuffer/typed-array, and direct binary HTTP responses. Valid bytes are stored via `putGeneratedImage`; invalid bytes fail with `PROVIDER_RESPONSE_UNSUPPORTED`.
- **RAGFlow hardening:** `validateEnhancement` discards objects that leak `final_prompt` / `compiled_prompt`, emit `reference_id` / `reference_ids`, contain URLs or data URIs, introduce binding-decision terms (`primary`, `auxiliary`, `weight`, `priority`, etc.), include internal terms (`RAGFlow`, `fallback`, `compiled_prompt`, `provider_internal_payload`), or contain top-level fields outside `TYPE_SCHEMAS.RagflowEnhancement`.
- **Prompt Compiler fallback:** local templates for `character_multiview`, `scene_multiview`, `prop_multiview`, and `storyboard` are reduced to consistency/safety constraints only; they do not prescribe four-view sheets, 3×3 boards, prop front/side/back boards, or fixed storyboard layouts unless those details come from user prompt or valid RAGFlow enhancement.
- **References:** every reference must provide `reference_id`, `entity_name`, `entity_type`, `role`, and `url`. URL-only objects fail. The `usage` field is accepted but stripped and never returned. Binding is by exact `entity_name`; multiple refs for the same entity/role are allowed; no weighting logic exists.
- **Callbacks:** `callback_url` / `callback.url` are normalized through the public-URL safety checker; the route never calls the URL and never returns callback status.
- **Forbidden public fields:** `FORBIDDEN_PUBLIC_FIELDS` includes `final_prompt`, `compiled_prompt`, `enhancement`, `input_analysis`, `storyboard_processing`, `storyboard_path`, provider raw fields, `base64`, `b64_json`, `binary`, `callback_status`, `ragflow_state`, `fallback_status`, etc. The scanner throws `INTERNAL_ERROR` if any leak.

### Findings requiring attention

#### 1. Legacy `ai-tu/gateway/server.js` still violates the V3.6 gateway contract

`ai-tu/gateway/server.js` remains in the tree as a “read-only migration reference” (`docs/provider-adapter-migration-map.md`). It is **not imported by the Final API runtime** (`server.js`), but the file itself does not satisfy the V3.6 gateway contract:

- It maintains its own job queue, in-memory reference-image store, and `/api/image-jobs` polling API.
- It uploads reference images to imgbb (`uploadReferenceToImgbb`).
- `runMockUpstream` returns `b64_json` SVG data with an empty `url`, i.e. mock success with raw bytes.
- `postSingleLiveImageUrlJson` can fall back to `gpt-image-2-all` when `config.imageModel` is unset.
- `extractImages` returns objects containing `b64_json` in the public job response instead of enforcing `images[].url`.

**Mitigation already in place:** `docs/provider-adapter-migration-map.md` explicitly marks these behaviors as “not migrated,” and the active `server.js` does not import or execute the gateway. The Final API service therefore meets the contract at runtime.

**Recommendation:** Either delete `ai-tu/gateway/server.js` from the active branch or move it to an `archive/` directory outside any importable path, so the repository contents unambiguously match the V3.6 contract.

#### 2. Prompt optimizer vs. Final API Prompt Compiler boundary may be confused

`src/routes/prompt-optimizations.js` (served at `/api/prompt-optimizer` and `/api/v1/prompt-optimizations`) is a **separate** public endpoint, not the Final API image-generation route. It intentionally returns a fully composed `optimized_prompt` for user editing, including task-specific professional templates. Its RAGFlow integration also permits a `template_guidance` field, which is **not** part of the Final API `TYPE_SCHEMAS.RagflowEnhancement`.

This is **not a contract violation** for the Final API, but the naming overlap could be confusing. The docs and tests correctly treat `src/core/prompt-compiler.js` as the Final API’s internal compiler and `prompt-optimizations.js` as the optimizer route.

#### 3. Documentation nit: empty section and imprecise wording

- `docs/spec/final_image_generation_api_spec_codex_autonomous_v1_4.md` contains an empty `## Provider Result Normalization` heading (line ~174). It should either be populated with the normalizer contract or removed.
- The same spec calls `/api/v1/prompt-optimizations` a “legacy route” in the malformed-JSON paragraph. It is a separate route, not a legacy one; this wording should be corrected to avoid contract confusion.

#### 4. Evidence scan currently fails because of a pre-existing report artifact

`npm run test:evidence` fails because an existing report in `.codex-agent-team/reports/` contains real `http://127.0.0.1:8787/api/v1/generated-images/img_<hash>` URLs. The test’s artifact-only forbidden pattern rejects those URLs. This is an evidence-hygiene issue, not a Final API source-code contract issue, but it means the evidence-scan gate is not clean on the current working tree.

This report avoids including any real generated-image URLs, keys, tokens, full prompts, or reference URLs.

## Verification Run

- `npm run check` — ✅ syntax check passes.
- `npm test` — ✅ 109 unit tests pass.
- `npm run test:provider-config` — ✅ real provider config present; model fixed to `gpt-image-2`; endpoints correct; no forbidden model values.
- `npm run test:evidence` — ❌ fails due to pre-existing generated-image URLs in `.codex-agent-team/reports/browser-qa-main01-repair-20260615.md`.

## Verdict

The **Final API runtime contract is established** in `src/`, `tests/`, and `API_CONTRACTS.md`. All listed contracts for the image-generation path pass: endpoints, provider model/routing, provider-result normalization (including binary/direct HTTP responses), RAGFlow JSON-only enhancement, Prompt Compiler minimal fallback, structured references, callback validation-only, and the forbidden-public-fields scanner.

No source file wrongly states that binary/direct image provider responses are not accepted.

The main residual gap is the **legacy `ai-tu/gateway/server.js` artifact**, which still encodes non-conforming V3.6 gateway behavior. Because the active `server.js` does not import or run it, the deployed service meets the contract, but the repository is not fully self-consistent until the legacy file is removed or archived.

**Overall verdict: PASS with reservations on the legacy gateway artifact and evidence-hygiene artifact.**
