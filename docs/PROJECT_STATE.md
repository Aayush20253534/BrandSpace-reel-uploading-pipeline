# Project State

## Current phase

Phase 10 — Queue and Scheduling

Status: Phases 1–9 are implemented and validated through live acceptance. Approved reel
versions can now enter the durable scheduling boundary before distribution.

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
- Google Drive OAuth development path and Shared Drive-aware storage adapter.
- AI provenance and usage accounting for model-backed stages.
- Idempotent planning, rendering, QA, and approval acceptance paths.

## Intentionally deferred

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
5. Complete human approval where required.
6. Configure Redis and schedule approved publishing work.
7. Run the full verification suite before each phase commit.

## Next phase

Phase 10 — Queue and Scheduling:
use PostgreSQL-backed publishing intents with BullMQ delayed delivery, deterministic
queue IDs, retries, and worker-side atomic dispatch claiming.
