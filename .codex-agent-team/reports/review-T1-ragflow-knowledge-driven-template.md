# Review: T1 RAGFlow Knowledge-Driven Template

Date: 2026-06-11

## Decision

Blocked for release. Code and contract checks passed, but the required real
provider browser acceptance did not produce a successful image result.

## Findings

No code findings in the Prompt Compiler, RAGFlow schema, validation tests, or
contract documentation changes.

## Verified

- Prompt Compiler fallback no longer injects full professional templates for
  character, scene, prop, or storyboard tasks.
- Valid enhancement still appends supported fields, including missing
  constraints.
- RAGFlow unsafe outputs are discarded for prompt leaks, unknown references,
  unknown URLs, non-JSON, array output, and internal implementation language.
- Public Final API response contract still excludes internal prompt/enhancement
  fields.
- RAGFlow system-prompt and knowledge seed docs were added under `docs/ragflow/`.

## Commands

- `npm run check`: pass
- `npm test`: pass, 78 tests
- `node tests/integration/provider-config.test.js`: pass,
  `REAL_PROVIDER_CONFIG_PRESENT`
- `node tests/integration/final-v1-4-evidence.test.js`: pass,
  `FINAL_V1_4_EVIDENCE_SCAN_PASS`
- `git diff --check`: pass
- `codegraph status --json`: pass with pre-commit `modified=3`

## Blocker

Codex-controlled Chrome submitted the local page to
`POST /api/v1/image-generations`. The request returned HTTP `502` with
`IMAGE_PROVIDER_CALL_FAILED`. A direct upstream probe returned HTTP `429` with
an upstream saturation/retry-later message. A cooldown retry through the Final
API still returned `502`.

Because no real provider image was returned, the required `images[].url`, image
preview, and generated-image GET `Cache-Control: no-store` proof could not be
completed in this run.
