# Provider Adapter Migration Map

Source file: `ai-tu/gateway/server.js` is a read-only migration reference.

Target runtime files:

- `src/providers/ai-tu-provider-adapter.js`
- `src/providers/provider-result-normalizer.js`
- `src/core/generated-image-store.js`
- `src/core/generated-image-response.js`
- `src/routes/image-generations.js`

The final service does not import or require the ai-tu gateway at runtime.

| ai-tu source | Final API target | Migration reason | Allowed | Notes |
| --- | --- | --- | --- | --- |
| provider base URL / endpoint config | `defaultProviderConfig`, `normalizeEndpoint` | Reuse real upstream endpoint configuration | yes | Reads env or runtime config without printing values. |
| provider auth headers / key selection | `activeKeys`, `nextImageApiCredential`, provider request builders | Keep Bearer auth behavior | yes | Key values never enter public response, evidence, or trace. |
| `runLiveUpstream` | `generateWithAiTuProvider` | Dispatch text-to-image and image-to-image URL JSON calls | yes | Mock branch and multipart edit branch excluded. |
| `baseUpstreamPayload` | `baseUpstreamPayload` | Preserve provider JSON payload fields | yes | Internal payload is never exposed. |
| `postLiveJson` | `postLiveJson` | Real text-to-image JSON upstream call | yes | Uses configured model and endpoint. |
| `postLiveImageUrlJson` | `postLiveImageUrlJson` | Real image-to-image JSON URL reference call | yes | Only uses downstream `references[].url`; no upload. |
| `postSingleLiveImageUrlJson` | `postSingleLiveImageUrlJson` | One provider request for URL references | yes | Keeps provider-compatible `image` URL array. |
| `fetchUpstream` | `fetchUpstream` | Retry loop and credential rotation | yes | No Authorization or raw payload logging. |
| `fetchUpstreamOnce` | `fetchUpstreamOnce` | Timeout, HTTP error handling, JSON/binary response parsing | yes | Binary image responses are wrapped for normalization. |
| `isRetryableUpstreamError` | `isRetryableUpstreamError` | Retry status policy | yes | 429/502/503/504 only. |
| `retryDelayMs` / retry-after parsing | `retryDelayMs`, `parseRetryAfterMs` | Backoff and retry-after support | yes | Timing metadata only. |
| `resolveUpstreamUrl` | `resolveUpstreamUrl` | Endpoint resolution | yes | Rejects non HTTP(S) endpoint config. |
| `extractImages` URL mapping reference | `provider-result-normalizer.js` | Map provider URL fields into `images[].url` | yes | Supports `url`, `image_url`, `output_url`, nested `data[]`, `images[]`, and `output[]`. |
| provider base64 result mapping | `provider-result-normalizer.js` + `generated-image-store.js` | Normalize real upstream `b64_json`, `base64`, data URL, or binary bytes | yes | Stores real provider bytes and returns `/api/v1/generated-images/:image_id`; no raw base64 in response/evidence. |
| async submit / poll / timeout pattern | `normalizeProviderResult`, `pollProviderResult` | Hide queued/running provider state from public API | yes | Public API returns final succeeded/failed only. |
| provider health/config check | `hasRequiredProviderConfig`, integration test | Fail safely when provider config is absent | yes | Missing config returns `PROVIDER_CONFIG_MISSING`, never fake success. |
| `runMockUpstream` | none | Mock success is forbidden | no | Not migrated. |
| `postLiveImageEditMultipart` | none | Multipart image edit/upload is forbidden | no | Not migrated. |
| `postSingleLiveImageEditMultipart` | none | Multipart image edit/upload is forbidden | no | Not migrated. |
| `uploadReferenceFromRequest` | none | Reference upload is forbidden | no | Not migrated. |
| `uploadReferenceToImgbb` | none | Image hosting is forbidden | no | Not migrated. |
| `readMultipartForm` | none | Multipart parsing is forbidden | no | Not migrated. |
| `serveReferenceImage` | none | Serving uploaded reference images is forbidden | no | Not migrated. |
| legacy UI/config routes | none | Final service serves ai-tu page through root server only | no | ai-tu gateway is not the final entrypoint. |
| old job response / prompt response | none | Old response shape can expose wrong fields | no | Final API never exposes internal prompt or provider payload. |
| hardcoded key/token/test account secret | none | Secrets must stay outside code and evidence | no | No key/token values are migrated. |
