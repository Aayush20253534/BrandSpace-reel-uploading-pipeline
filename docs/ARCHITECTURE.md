# BrandSpace Forge Architecture

## Product

BrandSpace Forge is Brand Space's internal AI Content Operating System.

The system will move client media through ingestion, analysis, planning, rendering,
approval, scheduling, publishing and analytics while keeping humans in control.

## Architectural style

Phase 1 establishes a modular monorepo with two deployable processes:

- `apps/web`: dashboard and application API.
- `apps/worker`: asynchronous/background execution.

Shared capabilities live in packages. This is deliberately not a microservice
architecture. Boundaries can later be extracted only when scale justifies it.

## Source of truth

PostgreSQL will be the source of truth for application state beginning in Phase 2/3. Phase 1 does not require Docker; managed PostgreSQL can be used directly when persistence is introduced.

Google Drive is the canonical binary media store. The database will store Drive file
IDs, revisions/checksums where available, ownership/client references, analysis state
and derived metadata. Drive is not the workflow database.

Redis, when introduced, is ephemeral infrastructure for queues, locks and short-lived coordination and may be consumed as a managed service.
It is never authoritative application state.

## Media storage

Brand Space will use a Google Shared Drive where available so media belongs to the
organization rather than an individual's My Drive.

Planned hierarchy:

BrandSpace Forge/
  Clients/
    <client-id>/
      Raw/
      Brand Assets/
      Generated/
      Published/

Folder names are for humans. Stable Drive IDs are the application identifiers.

Workers will download only the media needed for processing into ephemeral workspace,
verify it, process it, upload derived media back to Drive, then remove temporary files.

## AI boundary

AI is used for semantic/creative work. Scheduling, retries, state transitions,
publishing, file bookkeeping and database writes remain deterministic software.

## Security baseline

- No secrets in source control.
- Runtime configuration is validated.
- Client isolation is enforced server-side.
- Raw media is private by default.
- Workers use least-privilege credentials.
- External side effects will be idempotent.
- Every important mutation will eventually be auditable.
