# Final V1.4 Main01 Evidence

Status: MAIN01_PROTECTION_SUMMARY

This redacted artifact is part of the `main01` protection branch. It supersedes
older final-api evidence paths that are not present on the pushable branch.

## Provider Boundary

- Provider URL responses may be returned only after public URL validation.
- Provider encoded and binary image responses may be accepted only server-side.
- Server-side encoded or binary images are validated and stored in Generated
  Image Store.
- Public responses expose only `images[].url`.
- Invalid encoded bytes, wrong image magic, and mixed raw-provider payloads fail
  without raw leakage.

## Browser State

- Text generation was verified by a real browser rerun after one transient
  provider HTTP 502.
- Image edit was verified by real browser upload, edits request, public success,
  and generated-image GET no-store.
- This file does not claim main release PASS or authorize pushing `main`.

## Privacy

No credentials, raw provider request or response body, full reference link,
complete generated-image link, screenshot, trace, network capture, or encoded
image payload is recorded here.
