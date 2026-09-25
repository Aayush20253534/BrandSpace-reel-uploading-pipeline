# Phase 4.3 — Drive Media Ingestion

This phase turns verified Google Drive access into persistent media discovery.

## Behavior

- A client must have `Client.driveFolderId`.
- A full scan reads direct children of that folder.
- Video, image, and audio MIME types are accepted.
- Folders, Google-native Workspace documents, and unsupported MIME types are skipped.
- `MediaAsset` is upserted using the existing `(clientId, driveFileId)` unique key.
- Drive revision, parent, size, checksum, and timestamps are preserved where available.
- The Drive start-page token is persisted only after all asset upserts succeed.
- Re-running a scan is idempotent: existing Drive files are updated, not duplicated.

Incremental change-feed consumption remains deferred until queued execution is introduced.

## Live smoke test

1. Set a real client's `driveFolderId`.
2. Put one image or video directly inside that Drive folder.
3. Run `npm run drive:ingest -- <client-id>`.
4. Run it again.
5. The first run should report the asset under `created`; the second under `updated`.
6. Inspect `MediaAsset` and `DriveSyncState` in Prisma Studio.
