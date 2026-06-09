# Provider Adapter Migration Map

Source: `ai-tu/gateway/server.js` is read only. Target: `src/providers/ai-tu-provider-adapter.js`.

| ai-tu source | Target | Reason | Allowed | Notes |
| --- | --- | --- | --- | --- |
| `runLiveUpstream` | `generateWithAiTuProvider` | Dispatch text-to-image vs image-to-image URL JSON transport | yes | Remove mock branch and multipart edit branch. |
| `baseUpstreamPayload` | `baseUpstreamPayload` | Preserve provider JSON payload shape | yes | Used internally only; never logged/evidenced. |
| `postLiveJson` | `postLiveJson` | Real text-to-image upstream call | yes | Bearer auth from env credential. |
| `postLiveImageUrlJson` | `postLiveImageUrlJson` | JSON URL references for image-to-image | yes | Only `references[].url`; no upload. |
| `postSingleLiveImageUrlJson` | `postSingleLiveImageUrlJson` | Single request JSON URL reference payload | yes | Uses image model override when configured. |
| `fetchUpstream` | `fetchUpstream` | Retry loop and credential rotation | yes | Redacted retry metadata only. |
| `fetchUpstreamOnce` | `fetchUpstreamOnce` | Timeout, JSON parsing, upstream HTTP error handling | yes | No auth/header logging. |
| `isRetryableUpstreamError` | `isRetryableUpstreamError` | Retry status policy | yes | 429/502/503/504. |
| `retryDelayMs` | `retryDelayMs` | Exponential backoff and retry-after handling | yes | Preserves max delay. |
| `parseRetryAfterMs` | `parseRetryAfterMs` | Retry-after parsing | yes | Header value is not logged. |
| `resolveUpstreamUrl` | `resolveUpstreamUrl` | Endpoint selection | yes | Validated absolute HTTP(S) URL. |
| `extractImages` | `extractImageUrls` | Provider JSON response URL field mapping | yes, restricted | Only accepts URL fields; base64/binary-only responses fail. |
| `defaultRuntimeConfig` | `defaultProviderConfig` | Env-based provider config | yes, restricted | No config file write/read, no image host config. |
| `sanitizeRuntimeConfig` | `sanitizeProviderConfig` | Normalize runtime config | yes, restricted | Environment-derived only. |
| `normalizeEndpoint` | `normalizeEndpoint` | Endpoint validation | yes | Rejects non HTTP(S). |
| `activeKeys` | `activeKeys` | Key selection | yes | Values never logged. |
| `nextImageApiCredential` | `nextImageApiCredential` | Round-robin credential | yes | Exposes only index/count internally. |
| `runMockUpstream` | none | Mock success is forbidden | no | Explicitly excluded. |
| `postLiveImageEditMultipart` | none | Multipart edit/upload is forbidden | no | Explicitly excluded. |
| `postSingleLiveImageEditMultipart` | none | Multipart edit/upload is forbidden | no | Explicitly excluded. |
| `uploadReferenceFromRequest` | none | Reference upload is forbidden | no | Explicitly excluded. |
| `uploadReferenceToImgbb` | none | Image hosting is forbidden | no | Explicitly excluded. |
| `readMultipartForm` | none | Multipart parsing is forbidden | no | Explicitly excluded. |
| `serveReferenceImage` | none | Local image serving is forbidden | no | Explicitly excluded. |
| `publicJob` | none | Old job response is forbidden | no | Explicitly excluded. |
| `configPageHtml` / `serveConfigPage` | none | Old UI/config route is forbidden | no | Explicitly excluded. |
