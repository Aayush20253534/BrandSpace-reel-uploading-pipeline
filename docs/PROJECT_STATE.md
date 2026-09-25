# Project State

## Current phase

Phase 6 — Reel Planning

Status: Phases 1–5 are implemented and validated. Media intelligence covers deterministic
probing/preparation, transcription, scene detection, multimodal semantic understanding,
and stage-aware hardening. Reel planning is the next implementation phase.

## Completed

- Phase 1 production foundation.
- Phase 2 identity, authentication and multi-tenant client domain.
- Phase 3 pipeline domain model, audit/provenance and usage accounting.
- Phase 4 Google Drive storage and media ingestion.
- Phase 5 media intelligence and hardening.
- Provider-neutral Google Drive storage adapter.
- Shared Drive-aware paginated file discovery.
- Streaming worker downloads and generated-artifact uploads.
- Drive revision/checksum/parent/timestamp metadata mapping.
- Service-account private-key normalization.
- OAuth refresh-token authentication for personal My Drive development.
- Shared Drive connectivity/root-folder validation.
- Persistent per-client Drive synchronization cursor.
- FFprobe technical metadata extraction and deterministic media preparation.
- Provider-neutral Groq-backed transcription.
- Deterministic FFmpeg scene detection and usable-segment ranking.
- Multimodal semantic understanding with AI provenance and usage accounting.
- Stage-aware media preparation and provider/model result caching.
- Permanent media failures separated from transient infrastructure failures.

## Intentionally deferred

- Queue/BullMQ execution.
- FFmpeg rendering.
- Meta/Instagram API integration and SocialAccount credential model.
- Full operations dashboard.
- Incremental Google Drive change-feed ingestion.
- Source-revision-aware invalidation for cached media intelligence.
- Provider retry/backoff policy and transactional AI bookkeeping hardening.

## Current operator setup

1. For personal My Drive, configure the Desktop OAuth client ID/secret and root folder ID.
2. Run `npm run drive:auth` and store the returned refresh token in local `.env`.
3. Run `npm run drive:check`.
4. For production Shared Drive, use service-account authentication instead.
5. Run the full verification suite.

## Next phase

Phase 6 — Reel Planning:
build structured, validated reel blueprints from brand profile constraints and analyzed
media, persist immutable ReelVersion records and ReelSource lineage, and record AI
provenance/usage without allowing the model to invent source timestamps.
