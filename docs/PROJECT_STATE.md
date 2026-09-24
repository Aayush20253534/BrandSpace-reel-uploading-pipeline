# Project State

## Current phase

Phase 2 — Identity + Multi-Tenant Domain

Status: implemented; database migration must be applied to the chosen PostgreSQL
instance before runtime authentication is used.

## Completed

- Phase 1 production foundation.
- Prisma/PostgreSQL database package.
- Better Auth email/password authentication boundary.
- User/session/account/verification persistence models.
- Organization and membership tenancy model.
- Roles: OWNER, ADMIN, CONTENT_MANAGER, EDITOR, REVIEWER, ANALYST, VIEWER.
- Client ownership, lifecycle status, timezone and approval policy.
- Structured per-client BrandProfile.
- Server-side session/membership/role authorization helpers.
- Auth API handler and authenticated `/api/me` endpoint.
- ADR and domain-model documentation.

## Intentionally deferred

- Google Drive authentication/synchronization.
- MediaAsset and Reel pipeline tables.
- Queue/BullMQ.
- AI calls.
- FFmpeg rendering.
- Meta/Instagram integration.
- Full operations dashboard.

## Required operator setup

1. Provision managed PostgreSQL.
2. Set DATABASE_URL in `.env`.
3. Generate a strong BETTER_AUTH_SECRET.
4. Run `npm install`.
5. Run `npm run db:generate`.
6. Run `npm run db:migrate -- --name phase2_identity_tenancy`.
7. Run the verification suite.

## Next phase

Phase 3 — Pipeline Domain Model:
media assets, Reel projects/versions, jobs, approvals, publishing records, analytics,
audit events, AI decision provenance and usage accounting.
