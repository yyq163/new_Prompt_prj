# Poll URL Security Review Report

- **Repository:** `/Volumes/App_Dev/new_Prompt_prj`
- **Branch:** `main01`
- **HEAD:** `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f`
- **Review date:** 2026-06-15
- **Reviewer role:** Poll URL Security Reviewer

## 1. Scope

- `src/providers/ai-tu-provider-adapter.js` — handling of provider-returned `status_url` / `poll_url` and the outbound `Authorization` path.
- `src/core/url-security.js` — `isUnsafeNetworkHost` / `normalizePublicHttpUrl` helpers.
- `tests/unit/image-api.test.js` — existing poll-URL tests (approx. lines 1462–1597).
- New dedicated test file created per request: `tests/unit/provider-poll-url-security.test.js`.

> **Security note:** This report uses example hostnames (`provider.example.com`, `evil.example.com`, `poll.example.com`) and a placeholder key (`test-key`). No production credentials, real endpoints, or full URLs are disclosed.

## 2. Code Review Conclusion

### 2.1 Key security checks implemented

The adapter routes poll URLs through the following chain:

1. `findAsyncHandle()` reads `status_url` / `statusUrl` / `poll_url` / `pollUrl` plus an optional job id.
2. `resolveProviderPollEndpoint()` either uses the provided URL or builds one from `config.pollBaseUrl`.
3. `resolveAuthorizedUpstreamUrl()` enforces:
   - No whitespace.
   - No protocol-relative URLs (`//...`).
   - Only `http:` / `https:` schemes.
   - No embedded credentials (`user:pass@...`).
   - No unsafe network hosts (localhost, loopback, private ranges, link-local, IPv4/IPv6 mapped loopback, decimal/octal loopback encodings, etc.).
   - Origin must be in the approved set derived from `config.baseUrl`, `config.imageEditUrl`, and `config.pollBaseUrl`.
   - Path must start with `/v1/`.
4. `fetchUpstream()` adds the `Auth header: Bearer <key>` header **only after** `resolveAuthorizedFetchUrl()` has returned an authorized URL.

This means **evil third-party, localhost/private/link-local, malformed, or non-`/v1/` poll URLs are rejected before any outbound fetch, and therefore never receive the provider key.**

### 2.2 Requirement-by-requirement assessment

| Requirement | Assessment |
|-------------|------------|
| `evil.example` / third-party URLs do not receive `Authorization` | ✅ Rejected by `isApprovedProviderUrl()` origin check before `fetchUpstream()` is called. |
| `localhost` / private IP / link-local rejected | ✅ Rejected by `isUnsafeNetworkHost()` via `normalizeAuthorizedProviderUrl()`. |
| Malformed URL does not crash | ✅ Throws `ImageApiError` (`PROVIDER_POLL_URL_UNSAFE` or similar); no unhandled exceptions. Empty/whitespace `status_url` falls through to `IMAGE_RESULT_EMPTY` with no outbound fetch. |
| Same-origin absolute URL allowed, `Authorization` only to approved provider URL | ✅ Absolute URLs whose origin matches an approved configured endpoint and whose path starts with `/v1/` are allowed; `Authorization` is generated inside `fetchUpstream()` after URL authorization. |
| Relative path resolved against approved provider origin/path and allowed | ✅ `providerRelativeBase()` resolves leading `/` against `providerOrigin(baseUrl)`, and unprefixed/`./` paths against `pollBaseUrl` (or `baseUrl` origin if no `pollBaseUrl` is set). Allowed paths must still start with `/v1/`. |

### 2.3 Observations / low-risk items

- **Leading-slash relative paths use the generations origin, not `pollBaseUrl`.** In `providerRelativeBase()`, values starting with `/` (or `v1/`) are resolved against `providerOrigin(config.baseUrl)`. When `pollBaseUrl` points to a different host, a provider-returned `/v1/polls/...` path would be resolved to the generations host. This is not a security vulnerability but a routing-convention edge case that should be documented or aligned with the provider contract.
- **Configured submit endpoints are treated separately.** `resolveAuthorizedFetchUrl()` first attempts `resolveConfiguredUpstreamUrl()` for exact `baseUrl` / `imageEditUrl`; only if the value is not one of those endpoints does it fall through to `resolveAuthorizedUpstreamUrl()`. This prevents an attacker from using a configured local submit endpoint as a backdoor poll URL.
- **Fragment handling.** `normalizeAuthorizedProviderUrl()` strips the hash. Poll URLs with fragments are therefore allowed if the rest of the URL is approved; fragments are not sent to the server, so this is acceptable.

## 3. Test Coverage Matrix

| Scenario | Covered in `image-api.test.js` (lines ~1462–1597) | Covered in new `provider-poll-url-security.test.js` | Status |
|----------|--------------------------------------------------|-----------------------------------------------------|--------|
| Async poll succeeds and returns image URL | ✅ 1433–1460 | — | Covered |
| Evil third-party absolute URLs rejected, no fetch, no `Authorization` | ✅ 1462–1499 | ✅ "evil third-party poll URLs..." | Covered |
| `localhost` / `127.0.0.1` / private / link-local rejected | ✅ 1469–1481 | ✅ "localhost, loopback, private and link-local..." | Covered |
| Malformed / dangerous-scheme URLs rejected without crash | ✅ 1466–1467, 1482–1483 | ✅ "malformed or dangerous-scheme..." | Covered |
| Empty/whitespace `status_url` does not crash or fetch | — | ✅ "empty or whitespace status_url..." | **Supplemented** |
| Same-origin absolute URL allowed with `Authorization` | ✅ 1501–1541 | ✅ "same-origin absolute poll URL..." | Covered |
| Relative poll paths allowed and resolved correctly | ✅ 1501–1541 | ✅ "relative poll paths resolve..." | Covered |
| `Authorization` / key not leaked on rejected poll URL | ✅ 1543–1564 | ✅ "Auth header token is never emitted..." | Covered |
| Public error response does not leak URL / `Authorization` / key | ✅ 1543–1564 | ✅ "public error response does not leak..." | Covered |
| Routing regression: submit endpoints vs. poll URL allowlist | ✅ 1566–1597 | ✅ "configured submit endpoints are separated..." | Covered |

## 4. Fixes / Supplements Applied

- Created `tests/unit/provider-poll-url-security.test.js` containing all requested scenarios:
  - evil third-party URLs,
  - localhost / loopback / private / link-local addresses,
  - malformed / dangerous-scheme URLs,
  - same-origin absolute URLs,
  - relative paths (including `pollBaseUrl` resolution),
  - `Authorization` leak prevention,
  - public response leak prevention,
  - routing regression between submit endpoints and poll URL allowlist.
- Added explicit coverage for the empty/whitespace `status_url` edge case (no crash, no outbound fetch).

## 5. Remaining Recommendations

1. **Migrate duplicate coverage.** The poll-URL tests in `tests/unit/image-api.test.js` (lines ~1462–1597) are now duplicated by the focused file. Recommend migrating them to `tests/unit/provider-poll-url-security.test.js` and removing the duplicated blocks from `image-api.test.js` to improve maintainability.
2. **Document relative-path semantics.** Clarify in code comments or provider integration docs that provider-returned poll paths starting with `/` resolve against `baseUrl` origin, while bare/`./` paths resolve against `pollBaseUrl`.
3. **Consider runtime IP-layer enforcement.** The current host-based check is sufficient for the reviewed threats. If DNS rebinding becomes a concern in the future, add an additional resolution-time guard (resolve → IP check) before issuing the fetch.

## 6. Test Execution

```text
$ npm test
ℹ tests 118
ℹ suites 0
ℹ pass 118
ℹ fail 0
```

All unit tests pass, including the new poll-URL security suite.

## 7. Verdict

**PASS** — The `status_url` / `poll_url` handling in `src/providers/ai-tu-provider-adapter.js` satisfies the security requirements:
- unauthorized URLs cannot receive the provider `Authorization` header,
- localhost/private/link-local addresses are blocked,
- malformed input does not crash the process,
- same-origin and relative approved-provider URLs are allowed,
- no URL, `Authorization` header, or key is leaked in public error responses.

The new `tests/unit/provider-poll-url-security.test.js` file provides a dedicated, comprehensive regression suite for these guarantees.
