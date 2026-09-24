# Project State

## Current phase

Phase 3 — Pipeline Domain Model

Status: implemented in schema/domain code; apply the Phase 3 Prisma migration and run
the verification suite before starting Google Drive ingestion.

## Completed

- Phase 1 production foundation.
- Phase 2 identity, authentication and multi-tenant client domain.
- MediaAsset and MediaAnalysis persistence with Drive-oriented identifiers.
- ReelProject, immutable ReelVersion and source-clip lineage.
- RenderJob, QA review and approval records.
- PublishingJob with a unique idempotency key and explicit retry/attention states.
- Time-series ReelAnalyticsSnapshot storage.
- AuditEvent with organization/client and actor attribution.
- AI provenance without hidden chain-of-thought storage.
- UsageLedger for AI, render, storage and provider cost accounting.
- Deterministic ReelProject transition guard and publishing idempotency-key helper.
- CI hygiene for Turbo cache and production-build environment validation.

## Intentionally deferred

- Google Drive authentication/synchronization and actual media ingestion.
- Queue/BullMQ execution.
- AI provider calls.
- FFmpeg rendering.
- Meta/Instagram API integration and SocialAccount credential model.
- Full operations dashboard.

## Required operator setup

1. Keep the existing managed PostgreSQL `DATABASE_URL`.
2. Run `npm run db:generate`.
3. Run `npm run db:migrate -- phase3_pipeline_domain`.
4. Run `npm run format`.
5. Run the full verification suite.

## Next phase

Phase 4 — Google Drive Media Storage & Ingestion:
Shared Drive connection, client-folder mapping, file discovery/change tracking,
metadata synchronization, safe worker downloads and generated-artifact uploads.
