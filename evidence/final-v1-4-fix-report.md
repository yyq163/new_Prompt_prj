# Final V1.4 Fix Evidence

Date: 2026-06-11

Status: `PASS_ON_BRANCH`

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
- RAGFlow enhancement that attempts primary, auxiliary, priority, or weight
  binding semantics is discarded.
- RAGFlow system-prompt and knowledge seed docs were added under `docs/ragflow/`.

## Regression Tests Added

- Minimal fallback does not invent professional template structure.
- Knowledge enhancement fields enter the backend prompt.
- Storyboard fallback, normalized existing shots, preserve full prompt, and
  script-to-storyboard paths still work.
- Unsafe RAGFlow enhancement is discarded for prompt leaks, unknown references,
  unknown URLs, non-JSON output, array output, internal implementation words, and
  reference binding decision semantics.
- API contract, invalid body, callback, and Generated Image Store regressions
  remain covered by the existing suite.

Focused command:

```bash
node --test tests/unit/image-api.test.js
```

Latest focused result after the binding-decision repair: pass.

## Browser

- Page: `http://127.0.0.1:8793/`
- Browser surface: Codex in-app Browser
- Page-state screenshot: `evidence/screenshots/final-v1-4-contract-after-submit.png`
- Pre-submit screenshot: `evidence/screenshots/final-v1-4-contract-before-submit.png`
- Visible result: generated image URL and completed history entry available in
  the accepted browser run
- Final API HTTP status: `200`
- API status: `succeeded`
- Trace id: `trace_5b17210c1a3a4d0587`
- Generation id: `gen_2741feb461b843db9b`
- Image URL: `http://127.0.0.1:8793/api/v1/generated-images/img_c30fffcfab2447bc807553fe25561e37`

## Generated Image GET

- Image id: `img_c30fffcfab2447bc807553fe25561e37`
- HTTP status: `200`
- Content type: `image/png`
- Cache control: `no-store`
- Content length: `1999538`
- PNG magic bytes: yes

## Provider

- Provider configuration present: `true`
- Provider success mocked: `false`
- Accepted run path: visible page to `POST /api/v1/image-generations`
- Raw provider probe used as acceptance: `false`
- Later provider fluctuation probes are not part of the accepted browser run.

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
- Old priority and weight concepts remain absent and are discarded if RAGFlow
  attempts to emit them.
- Legacy client `usage` input remains ignored.
- Public image output remains URL-only.
- Provider success is not mocked.
- Production public base URL configuration remains enforced for service-generated image URLs.
- Legacy route is deprecated and not a final acceptance endpoint.
- Industrial concurrency is not claimed.
- Professional templates are knowledge-driven and not unconditional backend
  fallback.

## Evidence Directory

- `evidence/visual-e2e-report.md` describes the accepted Final V1.4 browser run.
- `evidence/final-v1-4-network-summary.json` and `evidence/network-summary.json`
  describe the same accepted run.
- `evidence/screenshots/` keeps the current Final V1.4 browser screenshots.
