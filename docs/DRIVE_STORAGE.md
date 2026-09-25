# Google Drive Storage and Ingestion

Google Drive is the canonical binary media store. PostgreSQL remains authoritative for
workflow state and stores stable Drive identifiers and metadata rather than media bytes.

## Drive layout

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

## Authentication modes

For local development with a personal My Drive, use OAuth so Forge acts as the Google
account that owns the media. Run `npm run drive:auth` once, approve access in the browser,
then store the returned refresh token in the local `.env`.

For production, prefer a Google Workspace Shared Drive with service-account
authentication. This keeps organization-owned media independent of one employee account.

## API behavior

In `my-drive` mode, listing uses the authenticated user's Drive corpus. In
`shared-drive` mode, listing is scoped with `corpora=drive` and `driveId`. Shared Drive
file operations enable Shared Drive support. Child listing is paginated. Downloads and
uploads stream data rather than buffering whole videos in memory.

`DriveSyncState` persists the per-client change cursor separately from media records.
A full scan establishes the baseline; incremental synchronization can then advance the
cursor only after database updates succeed.

## Security

- OAuth client secrets, refresh tokens, and service-account credentials stay server-side.
- Never commit `.env` or print credentials in application logs.
- Never expose credentials or private Drive media to browser code.
- Worker temporary paths must be application-created, not user-controlled.
- Downloads use exclusive file creation to avoid silently overwriting an existing file.
- AI providers never receive Google credentials.

## Operator configuration

Personal My Drive:

```env
GOOGLE_DRIVE_MODE=my-drive
GOOGLE_DRIVE_AUTH_MODE=oauth
GOOGLE_DRIVE_ID=
GOOGLE_DRIVE_ROOT_FOLDER_ID=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
```

Run `npm run drive:auth` to obtain the refresh token, then `npm run drive:check`.

Shared Drive:

```env
GOOGLE_DRIVE_MODE=shared-drive
GOOGLE_DRIVE_AUTH_MODE=service-account
GOOGLE_DRIVE_ID=
GOOGLE_DRIVE_ROOT_FOLDER_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

Escaped `\\n` sequences in the private key are normalized at runtime.
