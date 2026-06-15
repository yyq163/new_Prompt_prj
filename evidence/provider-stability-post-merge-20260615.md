# Provider Stability Evidence

Status: SUPERSEDED_BY_MAIN01_REPAIR

Older provider-stability evidence is superseded by the `main01` protection
branch repair. Any earlier visual success wording must not be used to claim
current edits-chain PASS.

Current protected contracts:

- `gpt-image-2` only.
- Text generation uses `/v1/images/generations`.
- Reference-backed image generation uses `/v1/images/edits`.
- Provider encoded and binary image forms are accepted only server-side and are
  converted into Generated Image Store URLs.
- Public API returns URL-only images and no raw provider material.
- Real image edit upstream status is superseded by the latest `main01` browser
  rerun: upload, edits request, public success, and generated-image GET no-store
  all passed.
