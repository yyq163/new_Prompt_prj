# Architecture Map

## Files

- `server.js`: HTTP entrypoint, routing, static assets, JSON parsing, public response emission.
- `src/routes/image-generations.js`: image generation orchestration.
- `src/core/runtime.js`: schema normalization, ID helpers, runtime config, redaction helpers.
- `src/core/entity-mentions.js`: `[实体名]` and `@实体名` extraction.
- `src/core/reference-binding.js`: reference validation and deterministic binding.
- `src/core/prompt-compiler.js`: backend-only prompt compiler and storyboard template routing.
- `src/core/ragflow-enhancement.js`: optional enhancement fetch and validation/discard policy.
- `src/core/errors.js`: public status/error helpers.
- `src/core/labels.js`: task and role labels.
- `src/providers/ai-tu-provider-adapter.js`: migrated provider adapter.
- `src/storage/trace-store.js`: redacted trace store.
- `src/web/*`: visible browser test console.
- `tests/unit/*`: pure unit and contract tests.
- `tests/integration/*`: service/provider integration tests.

## Data Flow

`server.js` -> route handler -> validation/binding -> optional enhancement -> prompt compiler -> provider adapter -> trace store -> public response.

## Forbidden Edges

- No import from `ai-tu/**`.
- No import from root `gateway/server.js`.
- No dependency on `external/ai-tu/**`.
- No response field containing final prompt, compiled prompt, enhancement, RAGFlow state, fallback, storyboard path, provider payload, key, cookie, or authorization header.
