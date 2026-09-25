# Phase 7.2 — Durable Generated Reel Artifact

Phase 7.2 promotes a successful local FFmpeg render into a durable platform asset.

## Storage contract

- The client `driveFolderId` is the storage boundary.
- A `Generated` child folder is reused or created beneath that client folder.
- The artifact name is deterministic: `reel-<project-id>-v<version>.mp4`.
- Before upload, the renderer checks for that exact artifact name to avoid duplicate
  Drive files after a partial failure.

## Persistence contract

After render and Drive upload, one serializable PostgreSQL transaction:

1. upserts `MediaAsset(kind=GENERATED_REEL)` by `(clientId, driveFileId)`;
2. binds `ReelVersion.renderedAssetId`;
3. marks the `RenderJob` `SUCCEEDED` with durable artifact metadata;
4. records `UsageLedger(kind=RENDER)`;
5. advances the project to `QA`.

If `ReelVersion.renderedAssetId` is already populated, a repeated invocation returns
the existing artifact without rendering or uploading again.

Google Drive and PostgreSQL cannot share one transaction. The deterministic filename
plus pre-upload lookup provides recovery idempotency when Drive succeeds but database
persistence fails.

## Live acceptance

The Phase 7.1 project may currently be `RENDERING`; Phase 7.2 explicitly permits
`PLANNED`, `RENDERING`, and `RENDER_FAILED` recovery states.

```powershell
npm run reel:render -- <reel-version-id> .\artifacts\phase7-2-reel.mp4
```

Acceptance requires:

- `[reel:render] durable render complete`;
- an MP4 inside the client's `Generated` Drive folder;
- a `GENERATED_REEL` MediaAsset;
- `ReelVersion.renderedAssetId` populated;
- `RenderJob.state = SUCCEEDED`;
- one RENDER usage-ledger entry for the successful durable render;
- `ReelProject.state = QA`.

Run the same command a second time. It must report
`[reel:render] durable artifact already exists` and must not create another Drive
artifact.
