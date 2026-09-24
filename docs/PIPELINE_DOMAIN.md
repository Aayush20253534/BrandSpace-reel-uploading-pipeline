# Pipeline Domain Model

Phase 3 makes PostgreSQL the authoritative state machine for the Reel pipeline.

## Media

`MediaAsset` stores client ownership and stable Google Drive identifiers while keeping
binary media out of PostgreSQL. `MediaAnalysis` stores structured analysis results and
can be retried independently from the asset.

## Reels and versions

`ReelProject` is the business workflow aggregate. `ReelVersion` is an immutable
creative/rendering version containing the structured blueprint. `ReelSource` records
which source assets and intervals were used, preserving lineage and reuse analysis.

Project state and job state are deliberately separate. A failed render does not erase
the Reel project, and a publishing retry does not pretend the creative lifecycle is a
single giant job.

## Jobs and review

`RenderJob`, `QaReview`, and `Approval` have independent state/history. This allows
multiple attempts and revisions without destroying earlier evidence.

## Publishing

`PublishingJob.idempotencyKey` is unique. Publishing workers must lock a due job and
must never publish again when `externalMediaId` is already present. Retryable provider
failures move through retry state; permanent credential/media/account failures move to
`NEEDS_ATTENTION`.

## Analytics

`ReelAnalyticsSnapshot` is append-only time-series data. New observations are inserted
rather than overwriting old metrics.

## Audit, AI provenance and cost

`AuditEvent` records actor/action/entity metadata at organization/client scope.
`AiProvenance` records provider/model/prompt version, structured outputs, latency,
confidence and cost. It must never store hidden chain-of-thought.
`UsageLedger` is the accounting surface for actual provider/compute/storage costs.

## Tenant rule

Every pipeline aggregate reaches a `Client` directly or through its parent aggregate.
Application services must resolve the active organization membership before querying
or mutating client resources. IDs alone are never authorization.
