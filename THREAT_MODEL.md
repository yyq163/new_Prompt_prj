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
- RAGFlow SSRF and credential exfiltration: RAGFlow endpoint is server-configured only. Deployment tier must be one of production, staging, development, or test; missing or alias tiers fail closed. Production and staging require HTTPS plus an exact allowed origin and always reject private endpoints. Development and test reject private endpoints unless explicitly configured for local/private RAGFlow. Unsafe schemes, userinfo, link-local, multicast, reserved, IPv4-mapped IPv6, unsafe DNS results, and malformed allowlists are rejected. Redirects are not automatically followed, and Authorization is sent only to the approved origin.
- RAGFlow resource exhaustion: responses are bounded by timeout, byte count, content-type, JSON depth, key count, array length, string length, and total character count. Invalid or oversized responses are discarded and do not fail the public optimizer request.
- Prompt optimizer schema injection: optimizer requests use a separate allowlist schema and reject callback, provider, model, credential, image/base64, raw provider payload, final prompt, compiled prompt, internal prompt, and unknown nested fields.
- Provider binary/base64 output: accept only through the server-side normalizer, validate supported image bytes, store in Generated Image Store, and return only generated image URLs. Invalid bytes or mixed raw-provider payloads fail with `PROVIDER_RESPONSE_UNSUPPORTED`.
- Callback exfiltration: callback is not implemented.
- Runtime dependency on untrusted source project: provider source is read-only migration input and not imported at runtime.

## Privacy Checks

Evidence may contain task type, redacted prompt summary, references metadata, response status, and generated image URL presence. Pushable evidence must not contain screenshots, complete generated image URLs, internal prompt, provider payload, raw RAGFlow output, authorization, cookies, token values, or encoded image bytes.
