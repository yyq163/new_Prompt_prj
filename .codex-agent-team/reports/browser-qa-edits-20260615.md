# Browser QA: main01 real provider rerun 2026-06-15

## 结论

PASS_MAIN01_BROWSER_RERUN_WITH_TRANSIENT_TEXT_FAILURE

真实浏览器覆盖文生图和图生图路径，未使用 mock success，未保存截图、
trace、network capture、raw provider payload、encoded image payload 或凭据。

## Text Image

- Endpoint kind: generations.
- Model: `gpt-image-2`.
- First run: HTTP 502 public failed after long provider wait.
- Fresh rerun: HTTP 200, public status succeeded, image count 1.
- Generated image GET: HTTP 200, content type image, `Cache-Control: no-store`.
- Interpretation: PASS after retry; provider availability showed transient
  failure and remains a known risk.

## Image Edit

- Upload source: local `/Volumes/App_Dev/test-image` image, only MIME and size
  were recorded.
- `/api/reference-images`: HTTP 200, public status succeeded, MIME image/jpeg,
  host `generated-image-store`.
- Endpoint kind: edits.
- Model: `gpt-image-2`.
- Final API: HTTP 200, public status succeeded, image count 1.
- Generated image GET: HTTP 200, content type image, `Cache-Control: no-store`.

## 安全

- No screenshots or browser captures are tracked.
- No raw request, raw response, prompt text, complete reference link, complete
  generated-image link, key, token, credential value, raw base64, or inline image
  payload is recorded.
- This browser PASS is for `main01` protection review only and does not push or
  merge `main`.
