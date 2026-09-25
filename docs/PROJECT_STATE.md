# Project State

## Current phase

Phase 4 — Google Drive Storage & Media Ingestion

Status: storage adapter and persistent Drive sync cursor implemented. Apply the Phase 4
migration, configure Shared Drive credentials and run verification before live ingestion.

## Completed

- Phase 1 production foundation.
- Phase 2 identity, authentication and multi-tenant client domain.
- Phase 3 pipeline domain model, audit/provenance and usage accounting.
- Provider-neutral Google Drive storage adapter.
- Shared Drive-aware paginated file discovery.
- Streaming worker downloads and generated-artifact uploads.
- Drive revision/checksum/parent/timestamp metadata mapping.
- Service-account private-key normalization.
- Shared Drive connectivity/root-folder validation.
- Persistent per-client Drive synchronization cursor.

## Intentionally deferred

- Media intelligence and transcription.
- Queue/BullMQ execution.
- FFmpeg rendering.
- Meta/Instagram API integration and SocialAccount credential model.
- Full operations dashboard.

## Required operator setup

1. Grant the service account access to the BrandSpace Forge Shared Drive.
2. Set GOOGLE_DRIVE_ID and GOOGLE_DRIVE_ROOT_FOLDER_ID.
3. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.
4. Run `npm install`.
5. Run `npm run db:generate`.
6. Run `npm run db:migrate -- phase4_drive_ingestion`.
7. Run the full verification suite.

## Next phase

Phase 5 — Media Intelligence:
FFprobe metadata extraction, thumbnails and representative frames, audio/transcription,
scene boundaries and structured AI clip analysis.
