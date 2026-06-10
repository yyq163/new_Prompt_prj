# Historical PRD Note

This document path is retained for compatibility with older links.

The current effective product contract is documented in:

- `docs/spec/final_image_generation_api_spec_codex_autonomous_v1_4.md`
- `API_CONTRACTS.md`
- `CODEGRAPH_REPORT.md`

Current references policy:

- `references[]` is strict structured input.
- `reference_id`, `entity_name`, `entity_type`, `role`, and `url` are required.
- URL-only references are not supported.
- Empty-entity global references are not supported.
- `pattern_reference` is accepted only as an alias of `ornament_reference`.
- `usage` from old clients is ignored and not returned.
- Multiple references for the same `entity_name + role` are allowed and all are used.
- No reference weighting field is used by current business logic.

Provider results can be external URLs, base64, data URLs, or binary image bytes. The public API always returns `images[].url`; real provider bytes are served through Generated Image Store.

Callback URLs are accepted and validated but not executed in this phase.

Industrial high-concurrency behavior is not claimed as complete in this phase. See `docs/concurrency-status.md`.
