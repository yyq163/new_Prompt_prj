# Threat Model

## Assets

- Provider API keys.
- RAGFlow credentials and raw outputs.
- Internal compiled prompt.
- Provider internal payload and provider task state.
- User reference image URLs.

## Risks And Controls

- Secret leakage through logs or evidence: never log authorization headers, cookies, `.env` values, provider keys, RAGFlow keys, or provider payloads.
- Prompt leakage through API or UI: public response schema excludes final prompt, compiled prompt, enhancement, fallback state, and storyboard path.
- Cross-reference image misuse: binding is deterministic by `entity_name`; RAGFlow cannot create or alter `reference_id`, URL, or binding decisions.
- Unsupported provider binary/base64 output: fail with `PROVIDER_RESPONSE_UNSUPPORTED`; do not upload or store images.
- Callback exfiltration: callback is not implemented.
- Runtime dependency on untrusted source project: provider source is read-only migration input and not imported at runtime.

## Privacy Checks

Evidence may contain task type, redacted prompt summary, references metadata, response status, image URL presence, trace ID, and screenshot paths. Evidence must not contain internal prompt, provider payload, raw RAGFlow output, authorization, cookies, or token values.
