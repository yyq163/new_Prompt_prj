# Architecture

## Runtime

The service is a Node.js ESM HTTP server started from root `server.js`. It serves static test console assets from `src/web/` and exposes `POST /api/v1/image-generations`.

## Request Pipeline

1. Parse JSON body with size limits.
2. Validate request schema.
3. Extract entity mentions from `[实体名]` and `@实体名`.
4. Bind mentions to `references[]` by deterministic `entity_name` matching.
5. Enforce anti-cross-reference rules.
6. Optionally request structured RAGFlow enhancement.
7. Validate and discard unsafe enhancement.
8. Compile backend-only prompt through deterministic local templates.
9. Call provider through `src/providers/ai-tu-provider-adapter.js`.
10. Normalize provider image URL response.
11. Persist redacted trace metadata.
12. Return public response without internal fields.

## Provider Boundary

Provider logic is copied and adapted from the read-only source `ai-tu/gateway/server.js`; the runtime never imports that file. Migrated code only covers environment config, endpoint validation, key rotation, JSON payloads, fetch timeout/retry/retry-after, URL extraction, provider error mapping, and internal async polling.

## Security Boundary

Secrets are read from environment variables only and never logged or returned. `.env` is not read, printed, modified, or committed by the agent.
