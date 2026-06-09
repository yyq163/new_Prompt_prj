# Design Delivery

## Delivered Surface

The high-fidelity deliverable for this service is an in-repository browser test console implemented under:

- `src/web/index.html`
- `src/web/app.js`
- `src/web/style.css`

## Page And State Coverage

- Initial form state with one editable reference row.
- Task type selection for all supported task types.
- Reference add/remove workflow.
- Submit loading state.
- Success state with image previews, image URLs, warnings, request ID, generation ID, and trace ID.
- Failure and clarification state with safe error messages.

## Completeness Evidence

Visual E2E evidence must be written after the service runs against real provider configuration:

- `evidence/visual-e2e-report.md`
- `evidence/network-summary.json`
- `evidence/screenshots/*.png`

No design state may expose final prompt, compiled prompt, enhancement, fallback, or provider payload.
