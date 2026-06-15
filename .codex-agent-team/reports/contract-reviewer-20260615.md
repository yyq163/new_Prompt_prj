# Contract Reviewer Report 2026-06-15

Status: SUPERSEDED_AND_REPAIRED_ON_MAIN01

The original review found provider endpoint/model and provider raw-response
contract drift in an older tree. Current `main01` repairs preserve the active
contracts:

- Final API entry remains `POST /api/v1/image-generations`.
- `references[]` remains structured; URL-only references are not supported.
- RAGFlow cannot set reference IDs, URLs, final prompt text, compiled prompt
  text, or binding decisions.
- Prompt Compiler fallback remains minimal and knowledge-driven.
- Public response exposes URL-only images and no internal prompt, provider,
  callback, RAGFlow, or encoded-image internals.
- Provider URL, encoded image, data URI, and binary/direct image results are
  normalized safely, with encoded/binary bytes converted to Generated Image
  Store URLs.
- Callback is validated only and not executed.

Latest real browser rerun proved image edit success on `main01`. This is
protection-branch evidence only and does not authorize pushing `main`.
