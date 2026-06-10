# Concurrency Status

Date: 2026-06-10

This service is not claiming industrial 1000-concurrency readiness.

## Current Capabilities

- The Node HTTP layer can accept concurrent requests.
- One image-to-image request can issue limited internal provider calls for multiple requested outputs.
- Provider credentials support round-robin selection.
- Provider calls have timeout, retry, retry-after, and polling basics.
- Generated image bytes are stored in an in-memory TTL store with count and size limits.

## Not Implemented Yet

- No global task queue.
- No global provider semaphore.
- No per-provider or per-key concurrency limit.
- No backpressure strategy.
- No persisted task state.
- No 1000-concurrency traffic shaping or surge buffering.
- No task cancellation, queue recovery, or durable resume.

## Operational Guidance

- Keep upstream provider `requestTimeoutSeconds` and retry attempts conservative.
- Treat `GENERATED_IMAGE_MAX_COUNT` and `GENERATED_IMAGE_MAX_BYTES` as memory safety limits, not storage durability guarantees.
- Add a queue, provider-level semaphore, and persistent job table before claiming high-concurrency production readiness.
