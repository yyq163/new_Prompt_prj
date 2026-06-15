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
- Provider binary/base64 output: accept only through the server-side normalizer, validate supported image bytes, store in Generated Image Store, and return only generated image URLs. Invalid bytes or mixed raw-provider payloads fail with `PROVIDER_RESPONSE_UNSUPPORTED`.
- Callback exfiltration: callback is not implemented.
- Runtime dependency on untrusted source project: provider source is read-only migration input and not imported at runtime.

## Privacy Checks

Evidence may contain task type, redacted prompt summary, references metadata, response status, and generated image URL presence. Pushable evidence must not contain screenshots, complete generated image URLs, internal prompt, provider payload, raw RAGFlow output, authorization, cookies, token values, or encoded image bytes.
