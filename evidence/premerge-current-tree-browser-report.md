# Pre-Merge Current Tree Browser QA

Status: PASS_CORE_TEXT_IMAGE_CURRENT_TREE

- Browser surface: Playwright headed browser with system Chrome.
- Page: http://127.0.0.1:8793/
- Local real config: used; sensitive values were not written to evidence.
- Final API endpoint: POST /api/v1/image-generations
- HTTP status: 200
- API status: succeeded
- Trace: trace_887e122c9c2f4e2cbb
- Request: req_da8df564b9d5472981
- Generation: gen_bbea9b38bed64989b8
- Image: img_38cc4787b590474993dc837637292a60
- Image URL: http://127.0.0.1:8793/api/v1/generated-images/img_38cc4787b590474993dc837637292a60
- UI preview: visible, natural size 1824x1024
- Generated image GET: HTTP 200, Content-Type image/png, Content-Length 1949856, Cache-Control no-store
- Old /api/image-jobs request count: 0
- Mock success: false

Screenshots:

- evidence/screenshots/premerge-current-tree-before-submit.png
- evidence/screenshots/premerge-current-tree-after-submit-preview.png

Reference upload probe: attempted with an enumerated local test image, but the root final service returned 404 for /api/reference-images. This optional probe is recorded as not accepted for merge evidence; the required text_image flow above is the passing browser acceptance path.
