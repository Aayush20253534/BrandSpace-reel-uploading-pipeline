# Project State

## Current phase

Phase 11 — Instagram Distribution

Status: Phases 1–10 are implemented and validated through live acceptance. Phase 11.1
introduces the tenant-scoped social-account and encrypted credential boundary required
before any Meta publishing calls are allowed.

## Completed

- Phase 1 production foundation.
- Phase 2 identity, authentication and multi-tenant client domain.
- Phase 3 pipeline domain model, audit/provenance and usage accounting.
- Phase 4 Google Drive storage and media ingestion.
- Phase 5 media intelligence and hardening.
- Phase 6 structured AI reel planning with immutable source lineage.
- Phase 7 deterministic FFmpeg rendering and durable generated reel artifacts.
- Phase 8 technical QA and deterministic creative/brand-policy QA.
- Phase 9 durable human approval requests and atomic decisions.
- Phase 10 durable BullMQ scheduling, PostgreSQL-to-Redis reconciliation, retry
  bookkeeping and worker-side atomic dispatch claiming.
- Google Drive OAuth development path and Shared Drive-aware storage adapter.
- AI provenance and usage accounting for model-backed stages.
- Idempotent planning, rendering, QA, approval, scheduling and queue reconciliation.

## Intentionally deferred

- Instagram OAuth callback and token verification/refresh.
- Temporary public media delivery for Meta ingestion.
- Instagram container creation/status polling and `media_publish`.
- Full operations dashboard.
- Incremental Google Drive change-feed ingestion.
- Source-revision-aware invalidation for cached media intelligence.
- Provider retry/backoff policy and transactional AI bookkeeping hardening.
- Subjective AI-assisted creative scoring.
- Version-bound approval schema hardening.

## Current operator setup

1. Configure Google Drive authentication and the client root folder.
2. Ingest and analyze media.
3. Plan, render, and persist a reel artifact.
4. Run technical and creative QA.
5. Complete human approval where required.
6. Configure Redis and schedule approved publishing work.
7. Run or observe queue reconciliation and dispatch.
8. Configure the social token-encryption key before importing Instagram credentials.
9. Run the full verification suite before each phase commit.

## Next phase

Phase 11.2 — Instagram OAuth:
implement Business Login for Instagram, OAuth state/PKCE protections where supported,
callback handling, token/profile verification, safe credential rotation and promotion
of verified Instagram accounts from `PENDING` to `CONNECTED`.
