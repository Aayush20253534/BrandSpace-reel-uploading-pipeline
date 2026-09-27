# BrandSpace Forge

BrandSpace Forge plans, renders, reviews and schedules client Reels. Google Drive
is the canonical media store. PostgreSQL owns workflow state; Redis and BullMQ
deliver scheduled work to the worker. Instagram Login publication and insights
code are present but remain disabled until staging and provider acceptance.

See [project state](docs/PROJECT_STATE.md) for implemented and deferred work,
and [human actions](docs/HUMAN_ACTIONS.md) for the exact external setup still
needed. The repository is not live accepted for Instagram publication.

## Pipeline

1. An organization owner/admin creates a client and grants users roles.
2. A full Google Drive scan imports client media metadata. Media intelligence
   probes and analyzes the selected source files.
3. Planning creates an immutable ReelVersion from the brand profile, analyzed
   media and structured creative history. The planner records AI provenance.
4. FFmpeg renders the version to a generated Reel stored back in Google Drive.
   Technical and creative QA inspect that exact version and artifact.
5. A person approves the version. Scheduling creates a durable PublishingJob
   in PostgreSQL. The worker reconciles the job into BullMQ and rechecks tenant,
   account, version, artifact and approval before dispatch.
6. When live publication is explicitly enabled after staging acceptance, the
   worker creates a short-lived signed HTTPS copy in a private S3-compatible
   bucket, creates and polls an Instagram Reel container, calls `media_publish`,
   verifies the remote media and records the result. Ambiguous remote writes
   stop for operator reconciliation instead of being retried blindly.
7. The separate, disabled-by-default insights collector captures immutable
   provider metric snapshots for published Reels. Structured feedback links
   creative choices to versions, source assets and snapshots without rewriting
   historical versions.

The authenticated dashboard covers clients, media, projects, QA, approvals,
jobs, accounts, analytics and audit. A scoped MCP endpoint exposes bounded
reads and narrow, audited draft, approval-request, schedule and queue-reconcile
tools. Agent tools cannot decide a person's approval.

## Requirements and local setup

- Node.js 22+ and npm; PostgreSQL and Redis.
- FFmpeg and FFprobe for media processing.
- Google Drive credentials and a client Drive folder.
- Meta app and private publication bucket only for live distribution.

Copy [.env.example](.env.example) to `.env` and fill only the values needed for
your environment. Never commit `.env` or put provider tokens in logs.

```powershell
npm ci
npm run db:generate
npm run db:deploy
npm run build
```

Apply migrations to a staging database and review the legacy approval/account
queries in [human actions](docs/HUMAN_ACTIONS.md) before production deployment.
The command above runs against whichever `DATABASE_URL` is configured; inspect
that target first. Start the built web app and worker as separate services:

```powershell
npm run start --workspace=@forge/web
npm run start --workspace=@forge/worker
```

Use `GET /api/health` for liveness and `GET /api/ready` for PostgreSQL
readiness. Both are uncached. The worker requires Redis for publishing dispatch.
`INSTAGRAM_LIVE_PUBLISH_ENABLED=false` and `INSTAGRAM_INSIGHTS_ENABLED=false`
are the safe defaults. Do not enable them merely because the build succeeds.

## Operator and agent entry points

The dashboard is at `/dashboard`. The Instagram connection begins at
`/api/social/instagram/connect?clientId=<client-id>` for an owner or admin.
The MCP endpoint is `POST /api/mcp` and requires a scoped bearer credential
issued through `npm run agent:token`; see
[MCP access](docs/PHASE_15_MCP_READ_INTERFACE.md).

The core operator commands are `drive:ingest`, `media:analyze`, `reel:create`,
`reel:plan`, `reel:render`, `reel:qa`, `reel:qa:creative`, `reel:approval` and
`reel:schedule`. Commands under `instagram:publish:reconcile`,
`instagram:insights:reconcile` and `reel:queue:reconcile` are for controlled
recovery. Each command's phase document contains arguments and preconditions.

## Verification

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=4096"
npm run format:check
npm run lint
npm run typecheck
npm run approval:typecheck
npm run agent:typecheck
npm test
npm run build
```

CI runs these gates on pushes and pull requests. Mock provider tests and builds
do not establish a successful live Meta post, bucket delivery or insights
capture. Those acceptance steps remain in [human actions](docs/HUMAN_ACTIONS.md).
