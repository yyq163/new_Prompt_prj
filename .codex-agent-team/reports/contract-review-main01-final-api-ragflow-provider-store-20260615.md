# Contract Review: main01 Final API / RAGFlow / Provider Routing / Generated Image Store

Date: 2026-06-15
Role: Contract Reviewer
Scope: read-only review of the main01 protection branch rebuild.

## Boundary

- Reviewed code, tests, and contract documents only.
- Did not open local runtime configuration, env files, credential files, or live provider responses.
- Did not run real provider or RAGFlow calls.
- This report is intentionally redacted for evidence scanning.

## Verdict

PASS with noted risks. The main Final API / RAGFlow / provider routing /
Generated Image Store contracts appear preserved in the main01 protection branch.

## Evidence Summary

- Prompt Compiler fallback remains minimal and does not inject professional
  multiview or storyboard templates without explicit user input or validated
  knowledge enhancement.
- RAGFlow enhancement remains knowledge-driven JSON and discards final prompt
  fields, compiled prompt fields, emitted references, URL decisions, binding
  semantics, unknown fields, and internal terms.
- Provider model remains fixed to `gpt-image-2`.
- Text or no-reference requests route to `/v1/images/generations`.
- Reference-backed requests route to `/v1/images/edits`.
- Poll/status URL safety is covered by allowlist tests before any credentialed
  provider follow-up request.
- Normalizer coverage includes `b64_json`, `base64`, `image_base64`,
  `data_url`, `data[0].image`, `data[0].result`, data URL input, binary
  objects, direct binary values, and direct binary HTTP image responses.
- Generated Image Store responses preserve `Cache-Control: no-store`.
- Public Final API image response remains URL-only.
- Callback URLs are validated but not executed.

## Risks

- `assertNoForbiddenProviderPayload` remains defined but not invoked. Current
  public responses still avoid leaking provider internals, but the behavior is
  permissive if a future contract requires rejecting such provider objects
  outright.
- Default configuration loader paths still exist. Review and CI commands must
  avoid printing or committing local configuration.
- A low-risk unused variable remains in generated image MIME normalization.
- The legacy prompt optimization route still contains task-specific prompt
  construction. This is outside the Final API image generation Prompt Compiler
  contract and must not be reused as Final API fallback.

## Re-review Note

This sanitized report replaces the initial verbose subagent artifact because the
verbose wording triggered the repository evidence scanner. No sensitive value was
used or copied into this report.
