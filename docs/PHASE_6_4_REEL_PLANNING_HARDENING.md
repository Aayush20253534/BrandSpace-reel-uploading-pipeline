# Phase 6.4 — Reel Planning Hardening

Phase 6.4 hardens the live-validated reel planning path before rendering.

## Changes

- Planning persistence is atomic: ReelVersion, ReelSource rows, ReelProject state,
  AiProvenance, and UsageLedger are written in one serializable transaction.
- Version allocation now happens inside that transaction and the project state is
  rechecked immediately before persistence.
- AI prompt versioning is independent from the persisted blueprint schema version.
- Deterministic banned-word enforcement runs after provider output validation.
- Groq prompt context is bounded to the top 24 ranked candidates.
- Repeated transcript/semantic context is deduplicated per media asset and transcript
  text is capped at 1,600 characters per asset.
- Groq requests explicitly use a 30 second timeout and three SDK retries.

## Retry policy

The OpenAI-compatible Node SDK retries connection failures, HTTP 408/409/429, and
5xx responses with backoff. Groq returns HTTP 429 when rate limits are exceeded and
provides `retry-after` when applicable. Phase 6.4 uses the SDK retry mechanism rather
than stacking a second retry loop around it.

## Still deferred

- Semantic enforcement of `forbiddenTopics`; exact banned wording is enforced here,
  but topic-level semantic policy belongs in creative QA.
- Cost pricing tables.
- Queue-based planning execution.
