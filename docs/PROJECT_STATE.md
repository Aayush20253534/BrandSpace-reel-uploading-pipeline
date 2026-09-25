# Project State

## Current phase

Phase 4 — Google Drive Storage & Media Ingestion

Status: storage adapter and persistent Drive sync cursor implemented. My Drive OAuth and
Shared Drive service-account authentication are supported. Run live verification before
enabling ingestion.

## Completed

- Phase 1 production foundation.
- Phase 2 identity, authentication and multi-tenant client domain.
- Phase 3 pipeline domain model, audit/provenance and usage accounting.
- Provider-neutral Google Drive storage adapter.
- Shared Drive-aware paginated file discovery.
- Streaming worker downloads and generated-artifact uploads.
- Drive revision/checksum/parent/timestamp metadata mapping.
- Service-account private-key normalization.
- OAuth refresh-token authentication for personal My Drive development.
- Shared Drive connectivity/root-folder validation.
- Persistent per-client Drive synchronization cursor.

## Intentionally deferred

- Media intelligence and transcription.
- Queue/BullMQ execution.
- FFmpeg rendering.
- Meta/Instagram API integration and SocialAccount credential model.
- Full operations dashboard.

## Required operator setup

1. For personal My Drive, configure the Desktop OAuth client ID/secret and root folder ID.
2. Run `npm run drive:auth` and store the returned refresh token in local `.env`.
3. Run `npm run drive:check`.
4. For production Shared Drive, use service-account authentication instead.
5. Run the full verification suite.

## Next phase

Phase 5 — Media Intelligence:
FFprobe metadata extraction, thumbnails and representative frames, audio/transcription,
scene boundaries and structured AI clip analysis.
