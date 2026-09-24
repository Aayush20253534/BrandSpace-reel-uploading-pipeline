# ADR-002: Google Drive as canonical media storage

Status: Accepted

## Decision

Raw client clips, brand assets and generated media will be stored in Google Drive.
Prefer a Google Shared Drive owned by Brand Space rather than an employee's My Drive.

PostgreSQL remains the authoritative store for application/workflow state. It stores
Drive IDs and media metadata rather than video bytes.

## Why

Brand Space wants its existing Drive workflow to remain the human-accessible content
pool. Workers can retrieve blob content through the Drive API and return generated
artifacts to Drive.

## Consequences

- The storage package must hide Google-specific implementation details.
- Media jobs need local ephemeral working storage for FFmpeg/analysis.
- Drive API quotas, download permissions and transient failures must be handled.
- Shared Drive requests must support shared-drive semantics.
- Folder names cannot be treated as stable identifiers; persist Drive IDs.
- Change detection should use Drive change/event mechanisms rather than repeatedly
  rescanning every folder.
