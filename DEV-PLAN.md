# Development Plan

## Task T1: Final Image API Service

Implement the final service under `/Volumes/App_Dev/new_Prompt_prj` without modifying `ai-tu/**`.

### Build

- Create root service entrypoint.
- Implement schema, labels, errors, runtime helpers.
- Implement entity mention extraction.
- Implement reference binding and anti-cross-reference checks.
- Implement prompt compiler with six task templates and storyboard fallback/path handling.
- Implement optional RAGFlow enhancement validation/discard.
- Migrate provider adapter logic from `ai-tu/gateway/server.js`.
- Implement redacted trace storage.
- Implement browser test console.

### Review

- Run unit and integration tests.
- Check forbidden fields in API responses and UI.
- Check provider adapter does not import `ai-tu/**`.
- Check upload/multipart/image-hosting logic was not migrated.
- Check evidence redaction.

### Visual Verification

Use Codex Browser / Computer Use to perform the required scene multiview flow against a real provider. If provider config is missing, stop with provider-config BLOCKED evidence rather than fake success.
