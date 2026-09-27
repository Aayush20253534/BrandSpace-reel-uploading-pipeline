# BrandSpace Forge implementation report

Status as of 2026-09-27: **not production complete**. The implemented paths pass
local lint, typecheck, mock tests, build, Prisma 6.19.3 validation and formatting.
No production migration, R2 acceptance, Instagram publish or insights request
has run from this workspace. The live worker switches remain off.

## Phase inventory

| Phase     | Implemented and verified locally                                                                                                                  | Evidence                                                                    | Remaining acceptance or work                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0–3       | Architecture, production foundation, Better Auth tenancy/RBAC, PostgreSQL domain and audit                                                        | Foundational history before `7466185`                                       | Staging roles, data and operational review                                                      |
| 4         | Google Drive canonical storage and full-scan ingestion; unchanged scans retain analyzed state                                                     | `9c03bb2`                                                                   | Real Drive smoke test, incremental change feed and revision-aware stage lineage                 |
| 5         | Media probes, transcription, scene and semantic intelligence                                                                                      | Phase 5 package tests                                                       | Revision-aware cache invalidation and production media baselines                                |
| 6         | Structured AI planning with brand/media context, provenance and feedback context                                                                  | `3343aec` plus prior planning history                                       | Provider retry/accounting review under concurrent load                                          |
| 7         | Deterministic FFmpeg render and durable Google Drive artifact                                                                                     | `b72c58b`, `bc96446`                                                        | Representative staging media and resource limits                                                |
| 8         | Technical and deterministic creative QA                                                                                                           | `75a4a15`, `adda52c`                                                        | Human evaluation of subjective creative quality                                                 |
| 9         | Durable, exact-version human approval requests and decisions                                                                                      | `21a9664`, `e3bdd64`, `f3f89ca`                                             | Legacy approval migration review in staging                                                     |
| 10        | Durable scheduling, BullMQ dispatch/reconciliation and replay guards                                                                              | `224cf13`, `78154d3`, `cb97b07`, `04d8028`, `96cfe01`                       | Redis loss, crash and scale exercise in staging                                                 |
| 11.1–11.3 | Encrypted SocialAccount credentials, Instagram Login OAuth and refresh                                                                            | `7466185`, `c7501e7`, `6f06692`, `4af16f3`, `5cee52f`, `0e8a45e`            | Meta app access, test account, token rotation rehearsal                                         |
| 11.4      | Private S3-compatible temporary delivery with signed URL and cleanup                                                                              | `810fd8f`                                                                   | Private bucket, scoped credentials, signed GET and cleanup acceptance                           |
| 11.5–11.7 | Instagram Login container create, polling, `media_publish`, remote verification, ambiguous-write quarantine and audited recovery; disabled        | `42106e6`, `871cb19`, `cb97b07`, `04d8028`, `96cfe01`                       | Finish official limits/errors review and controlled real staging post with explicit approval    |
| 12        | Scoped operator dashboard, account health, approvals, jobs, analytics and audit                                                                   | `428ea0a`, `f3f89ca`, `cb97b07`                                             | Staging visual, keyboard, role and data acceptance                                              |
| 13        | Bounded immutable insights snapshots, provider read adapter, disabled collector and raw dashboard values                                          | `5cb9bdd`, `8d07f66`, `7f37059`                                             | Reel-specific metrics/period table, Meta app access, staging snapshots and trend/summary UX     |
| 14        | Versioned creative observations and bounded client planning context                                                                               | `3343aec`                                                                   | Outcome aggregation after compatible, real insights snapshots                                   |
| 15        | Scoped bearer MCP reads and audited draft, approval-request, schedule and queue-reconcile mutations                                               | `28ebaa1`, `7dfa039`, `96802c2`, `6354f2b`, `89e1db8`, `6d24a5c`            | Durable planning/render/QA request tools and hosted ChatGPT OAuth                               |
| 16        | Safe agent workflow documentation and limited MCP actions                                                                                         | `89e1db8`, `6d24a5c`                                                        | End-to-end agent creation workflow after durable stage requests exist                           |
| 17        | Version-bound approvals, active-account uniqueness, token keyring, bounded provider calls, replay/late-start safety, readiness probe and CI gates | `e3bdd64`, `4af16f3`, `5cee52f`, `0e8a45e`, `394bf31`, `04d8028`, `96cfe01` | Staging security/CSRF review, Meta callback requirements, incident drills and dependency review |
| 18        | Targeted indexes, bounded reads, synthetic MCP load probe and scale/cost assumptions                                                              | `ac122f4`                                                                   | Staging EXPLAIN/load measurements, per-client fairness and provider quota baselines             |

## Verification and migrations

- The most recent full run passed **64/64 Turbo tasks** across lint, typecheck,
  tests and build. Prettier check, `git diff --check`, agent script typecheck,
  Prisma schema validate and Prisma Client generation also passed. Provider
  calls in tests use mocks. CI runs the repository gates on push and pull request.
- New forward migrations cover temporary delivery, exact-version approvals,
  unique active social ownership, MCP credentials/idempotency, hot-query indexes,
  feedback observations, publication intents, analytics collection and optional
  OAuth requested scopes. Their paths are under
  `packages/database/prisma/migrations/20260926*` and `20260927*`.
- No staging or production `db:deploy` was run here. Existing-data backfill and
  index lock behavior are unverified; the exact review queries are in
  [human actions](HUMAN_ACTIONS.md).

## Production blockers and human actions

1. Complete the official Meta Reel limits, errors, rate limits and
   Reel-specific media insights metric table. User-supplied Meta screenshots
   already confirm the Instagram Login host, publishing edges, status values,
   permissions and media insights edge. The Meta app setup screen and API
   reference give different guidance about Instagram Login insights; resolve
   this with a test account before enabling collection.
2. Create the private S3-compatible temporary publication bucket, restricted
   object credential and three-day `publication/` lifecycle rule; then prove
   signed read and cleanup behavior in staging.
3. Review and apply migrations to staging, including legacy approval and active
   account ownership queries. Back up and schedule production migration only
   after staging review.
4. Grant the app's publishing permissions, connect a dedicated professional
   test account, approve one exact test version and publish time, and authorize
   a controlled real post separately. Keep
   `INSTAGRAM_LIVE_PUBLISH_ENABLED=false` until then.
5. For insights, obtain `instagram_business_manage_insights`, apply the OAuth
   scopes migration, set `INSTAGRAM_REQUEST_INSIGHTS_SCOPE=true` on the web
   service, reconnect the test account, choose Reel-supported `day` metrics and
   verify two captures. Keep `INSTAGRAM_INSIGHTS_ENABLED=false` until then.

The exact dashboard paths, field names, commands and verification checks are
in [human actions](HUMAN_ACTIONS.md). No token or secret should be shared in a
prompt or committed to the repository.

## Security and operational notes

- Social tokens and staged OAuth results use AES-256-GCM; the keyring supports
  audited rotation. Browser/MCP responses exclude credentials. MCP credentials
  are scoped, revocable hashes with per-credential database rate limits.
- Version-bound human approval is checked when scheduling, dispatching and
  before the first provider write. Remote create/publish intent timestamps are
  stored before each non-idempotent request. Ambiguous outcomes stop for manual
  verification; no automatic second post is attempted.
- A dispatch starting more than 15 minutes late is quarantined. An owner/admin
  can cancel only an untouched stale job through the audited operator command
  and then schedule a new time.
- `GET /api/health` checks web liveness; `GET /api/ready` checks PostgreSQL.
  Worker, Redis, bucket and provider health still need deployment monitoring.
- No Meta webhook, deauthorization or data-deletion callback has been added.
  Implement these if the current app review requirements for this app demand
  them; the relevant official requirement and signing contract are still to be
  supplied or verified.

## Deployment and acceptance checklist

1. Pin Node 22+, npm and Prisma 6.19.3; run `npm ci`, Prisma generate and all CI
   gates. Keep `.env` and provider keys in a deployment secret manager.
2. Provision PostgreSQL, Redis, Google Drive access, FFmpeg/FFprobe, a private
   temporary bucket and separate web/worker processes. Set exact public
   `APP_URL`, `BETTER_AUTH_URL` and Instagram OAuth redirect URI.
3. Back up staging, run migration review queries and `npm run db:deploy` there.
   Verify `/api/ready`, role boundaries, Drive ingest, render/QA and approvals.
4. Run queue crash/replay and temporary-media cleanup drills. Inspect
   `NEEDS_ATTENTION` counts, token expiry and immutable audit events.
5. Complete Meta App Review for the required Instagram Login permissions and
   connect a test professional account. Only then approve one real test post,
   enable live publication for a controlled worker and verify the remote Reel.
6. Enable insights separately after the Reel metrics contract and test capture
   pass. Review dashboard values before any outcome aggregation is trusted.
7. Measure p50/p95 queries, worker lag, Drive download volume, FFmpeg resource
   use, provider quotas and temporary storage cost on representative staging
   data before scaling toward thousands of clients.

## Known code limitations

- Incremental Drive change feed and full source-revision-aware analysis lineage
  are not implemented. Changed assets lose readiness and must be reprocessed;
  old stage caches can still need manual review.
- MCP planning, render and QA requests are not exposed. Operators can run the
  established commands; agents can create drafts, request approval, schedule
  approved versions and reconcile safe queue jobs.
- Analytics trend, account summary and creative outcome aggregation cannot be
  trusted until the Reel-specific metric meanings and windows are verified.
- Worker queue fairness, provider quota enforcement and live scale limits have
  not been measured or implemented for thousands of customers.
- A complete end-to-end live acceptance result does not exist. The overall
  platform must not be represented as production complete.
