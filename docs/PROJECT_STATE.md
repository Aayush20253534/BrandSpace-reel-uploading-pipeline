# Project State

## Current phase

Phase 11 — Instagram Distribution

Status: Phases 1–10 and 11.1–11.4 are implemented locally. Phase 11.4 live
acceptance awaits a private S3-compatible bucket and scoped credentials. The new
migration has been validated but has not been applied to a live database.
Phase 12's authenticated operator dashboard, scoped read views and guarded queue
reconciliation are implemented locally; staging role and data acceptance remain.
Phase 17 version-bound approval hardening is implemented locally and awaits
migration and existing-data review.

## Completed

- Phase 1 production foundation.
- Phase 2 identity, authentication and multi-tenant client domain.
- Phase 3 pipeline domain model, audit/provenance and usage accounting.
- Phase 4 Google Drive storage and media ingestion.
- Phase 5 media intelligence and hardening.
- Phase 6 structured AI reel planning with immutable source lineage.
- Phase 7 deterministic FFmpeg rendering and durable generated reel artifacts.
- Phase 8 technical QA and deterministic creative/brand-policy QA.
- Phase 9 durable human approval requests and atomic decisions.
- Phase 10 durable BullMQ scheduling, PostgreSQL-to-Redis reconciliation, retry
  bookkeeping and worker-side atomic dispatch claiming.
- Phase 11.1 tenant-scoped SocialAccount records and AES-256-GCM credential storage.
- Phase 11.2 server-side Instagram Login OAuth, durable one-time state, long-lived token
  exchange, professional-account verification and encrypted credential rotation.
- Google Drive OAuth development path and Shared Drive-aware storage adapter.
- AI provenance and usage accounting for model-backed stages.
- Idempotent planning, rendering, QA, approval, scheduling and queue reconciliation.
- Phase 11.3 automatic Instagram token lifecycle and reauthentication transitions.
- Phase 12 operator dashboard code: authenticated shell, scoped selectors, twelve
  views, role-gated reads and approval decisions, account connection entry point,
  queue reconciliation action, audit trail and responsive loading/error/empty
  states.
- Phase 17 version-bound approval request, decision, scheduling and dispatch
  guards, plus a conservative migration for legacy approvals.
- Phase 17 Instagram connection hardening: transaction-bound OAuth state,
  encrypted exchange recovery, callback error redaction and database-enforced
  unique active account ownership across clients.
- Phase 15 read-only MCP foundation with scoped bearer credentials, live
  membership RBAC, database rate limiting, bounded read tools and token audit.
- Phase 17 social token keyring support and audited rewrap command; worker
  refresh errors now store stable sanitized messages.

## Implemented, awaiting live acceptance

- Phase 11.4 private S3-compatible temporary publication media delivery, signed
  short-lived read URLs, durable references and expiry cleanup.

## Intentionally deferred

- Instagram Login container creation/status polling and `media_publish` pending
  verification of the current Instagram Login-specific Meta API contract. The
  official Postman Reels examples found to date are for Facebook Login and Page
  tokens, so they cannot safely supply this contract.
- Phase 12 staging visual and role acceptance.
- Incremental Google Drive change-feed ingestion.
- Source-revision-aware invalidation for cached media intelligence.
- Provider retry/backoff policy and transactional AI bookkeeping hardening.
- Subjective AI-assisted creative scoring.
- Phase 15 mutation MCP tools and OAuth authorization for hosted ChatGPT
  clients; the current bearer-token interface is read only.

## Current operator setup

1. Configure Google Drive authentication and the client root folder.
2. Ingest and analyze media.
3. Plan, render, and persist a reel artifact.
4. Run technical and creative QA.
5. Complete human approval where required.
6. Configure Redis and schedule approved publishing work.
7. Configure Meta app credentials, the exact Instagram OAuth redirect URI and the
   social token-encryption key.
8. Connect an Instagram professional account through the server-side OAuth endpoint.
9. Run the worker so due Instagram credentials are refreshed automatically.
10. Configure the private temporary publication bucket and its scoped credential
    (see `HUMAN_ACTIONS.md`). Generate Prisma Client, apply the 11.4 migration
    and build packages before starting the worker.
11. Run the full verification suite before each phase commit.

## Next phase

Phase 11.5 — Instagram Reel container creation after the Instagram Login-specific
Meta contract is verified. Continue independent Phase 12–18 work meanwhile.
