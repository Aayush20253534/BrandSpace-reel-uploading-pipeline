# Project State

## Current phase

Phase 9 — Approval Workflow

Status: Phases 1–8 are implemented and validated through live acceptance. The pipeline
now reaches a durable human approval boundary after media intelligence, reel planning,
rendering, generated-artifact persistence, technical QA, and deterministic creative QA.

## Completed

- Phase 1 production foundation.
- Phase 2 identity, authentication and multi-tenant client domain.
- Phase 3 pipeline domain model, audit/provenance and usage accounting.
- Phase 4 Google Drive storage and media ingestion.
- Phase 5 media intelligence and hardening.
- Phase 6 structured AI reel planning with immutable source lineage.
- Phase 7 deterministic FFmpeg rendering and durable generated reel artifacts.
- Phase 8 technical QA and deterministic creative/brand-policy QA.
- Google Drive OAuth development path and Shared Drive-aware storage adapter.
- AI provenance and usage accounting for model-backed stages.
- Idempotent planning, durable rendering, and QA acceptance paths.

## Intentionally deferred

- Queue/BullMQ execution and scheduling.
- Meta/Instagram API integration and SocialAccount credential model.
- Full operations dashboard.
- Incremental Google Drive change-feed ingestion.
- Source-revision-aware invalidation for cached media intelligence.
- Provider retry/backoff policy and transactional AI bookkeeping hardening.
- Subjective AI-assisted creative scoring.

## Current operator setup

1. Configure Google Drive authentication and the client root folder.
2. Ingest and analyze media.
3. Plan, render, and persist a reel artifact.
4. Run technical and creative QA.
5. For clients requiring human approval, create and decide a durable approval request.
6. Run the full verification suite before each phase commit.

## Next phase

Phase 9 — Approval Workflow:
persist idempotent approval requests and atomic approve/revision/reject decisions with
actor attribution and audit events before scheduling is allowed.
