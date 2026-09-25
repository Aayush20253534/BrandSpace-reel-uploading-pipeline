# Google Drive Storage and Ingestion

Google Drive is the canonical binary media store. PostgreSQL remains authoritative for
workflow state and stores stable Drive identifiers and metadata rather than media bytes.

## Shared Drive layout

```text
BrandSpace Forge/
  Clients/
    <client>/
      Raw/
      Brand Assets/
      Generated/
      Published/
```

`Client.driveFolderId` identifies the client folder. Names are human-facing labels only.

## API behavior

The storage adapter scopes listing to the configured Shared Drive using `corpora=drive`
and `driveId`, and enables Shared Drive support on file operations. Child listing is
paginated. Downloads and uploads stream data rather than buffering whole videos in memory.

`DriveSyncState` persists the per-client change cursor separately from media records.
A full scan establishes the baseline; incremental synchronization can then advance the
cursor only after database updates succeed.

## Security

- Service-account credentials stay server-side.
- The service account should receive only the Drive access Forge needs.
- Never expose credentials or private Drive media to browser code.
- Worker temporary paths must be application-created, not user-controlled.
- Downloads use exclusive file creation to avoid silently overwriting an existing file.
- AI providers never receive Google credentials.

## Operator configuration

Set:

```env
GOOGLE_DRIVE_ID=
GOOGLE_DRIVE_ROOT_FOLDER_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

Escaped `\\n` sequences in the private key are normalized at runtime.
