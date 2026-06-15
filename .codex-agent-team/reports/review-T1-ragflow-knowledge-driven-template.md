**Status:** HISTORICAL — superseded by the screenshot-policy repair cycle.

# Review: T1 RAGFlow Knowledge-Driven Template

Date: 2026-06-15

## Decision

`PASS_ON_BRANCH_FOR_MAIN01_PROTECTION`.

This review remains valid only for the RAGFlow knowledge-driven template
contract on the `main01` protection branch. It does not claim `main` release
PASS and does not claim current image-edit provider PASS.

## Verified

- Prompt Compiler fallback does not inject full professional templates for
  character, scene, prop, or storyboard tasks.
- RAGFlow unsafe outputs are discarded for prompt leaks, reference emissions,
  URLs, non-JSON, array output, internal implementation language, and binding
  decision semantics.
- Public Final API response still excludes internal prompt, enhancement,
  provider payload, encoded image, callback, RAGFlow, and fallback internals.
- Pushable evidence is text-only and redacted.
- Browser screenshot artifacts are retained as sanitized PNG files and tracked on `main01`.

## Current Main01 Limitation

Latest real browser rerun proved `/v1/images/edits` success without mock
success. This remains protection-branch evidence only and does not authorize
`main` push.

## Gate

Machine gate source:
`.codex-agent-team/reports/review-T1-ragflow-knowledge-driven-template.json`.
