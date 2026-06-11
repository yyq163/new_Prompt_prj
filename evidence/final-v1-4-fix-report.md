# Final V1.4 Fix Evidence

Date: 2026-06-11

Status: fail only on real provider/browser completion; local build, tests, and
contract checks passed, but upstream provider returned saturation/502 during
real browser validation

## RAGFlow Knowledge-Driven Template Repair

- Prompt Compiler fallback now keeps minimal task safety text instead of
  unconditional professional templates.
- Character fallback no longer auto-adds four-view, head detail, side/back pose,
  stance, or background template detail.
- Scene fallback no longer auto-adds grid, multi-camera, floor-plan, overview,
  or shot-diagram template detail.
- Prop fallback no longer auto-adds fixed angle, material close-up, ornament
  close-up, use-state, or scale template detail.
- Storyboard fallback now uses a minimal backend path and only keeps the
  defensive rule that shot count, total duration, and grid layout are not fixed
  by default.
- Valid RAGFlow enhancement can still add scene summary, visual focus, story
  function, action stages, shot plans, lighting, composition, negative notes, and
  missing constraints.
- RAGFlow system-prompt and knowledge seed docs were added under `docs/ragflow/`.

## Regression Tests Added

- Minimal fallback does not invent professional template structure.
- Knowledge enhancement fields enter the backend prompt.
- Storyboard fallback, normalized existing shots, preserve full prompt, and
  script-to-storyboard paths still work.
- Unsafe RAGFlow enhancement is discarded for prompt leaks, unknown references,
  unknown URLs, non-JSON output, array output, and internal implementation words.
- API contract, invalid body, callback, and Generated Image Store regressions
  remain covered by the existing suite.

Command:

```bash
node --test tests/unit/image-api.test.js
```

Latest focused result: pass, 56 tests.

## Browser

- Page: `http://127.0.0.1:8793/`
- Preferred browser surface: Codex in-app Browser
- Browser fallback: Codex-controlled Chrome, because the in-app Browser webview
  did not attach twice
- Screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Visible result: failed with explicit provider error
- Final API HTTP status: `502`
- API error code: `IMAGE_PROVIDER_CALL_FAILED`
- Trace id: `trace_38caff6d133c400289`
- Generation id: none

## Generated Image GET

- Image id: none
- HTTP status: not run
- Content type: not run
- Cache control: not run
- Content length: not run
- Blocker: provider returned no image URL or bytes

## Provider Probe

- Provider configuration present: `true`
- Provider host: `memefast.top`
- Direct upstream probe HTTP status: `429`
- Direct upstream probe summary: upstream group saturated, retry later
- Follow-up Final API curl after cooldown: still `502 IMAGE_PROVIDER_CALL_FAILED`

## Callback

- Public HTTPS callback URL accepted by contract tests: `true`
- Local and private callback URLs rejected by contract tests: `true`
- Unsafe callback schemes rejected by contract tests: `true`
- Callback delivery attempted: `false`
- Callback task returned: `false`

## Contract Summary

- Structured references remain required.
- URL-only references remain unsupported.
- Empty-entity global references remain unsupported.
- Old priority and weight concepts remain absent.
- Legacy client `usage` input remains ignored.
- Public image output remains URL-only.
- Provider success is not mocked.
- Production public base URL configuration remains enforced for service-generated image URLs.
- Legacy route is deprecated and not a final acceptance endpoint.
- Industrial concurrency is not claimed.
- Professional templates are knowledge-driven and not unconditional backend
  fallback.

## Evidence Directory

- `evidence/visual-e2e-report.md` describes the current Final V1.4 browser run.
- `evidence/final-v1-4-network-summary.json` and `evidence/network-summary.json` describe the same run.
- `evidence/screenshots/` keeps the current Final V1.4 browser screenshots.
