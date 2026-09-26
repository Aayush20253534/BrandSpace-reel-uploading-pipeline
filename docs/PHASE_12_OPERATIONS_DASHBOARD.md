# Phase 12: operations dashboard

The internal workspace lives at `/dashboard`. Better Auth sessions gate every
dashboard route. The selected organization must belong to the signed-in user;
the selected client must belong to that organization. Invalid scopes return 404.
The application selects only display fields, never social token ciphertext or
signed publication media URLs.

## Sections

The overview summarizes active reels, pending approvals, scheduled jobs, jobs
needing attention, connected accounts, recent projects and upcoming work. The
sidebar provides media, projects, versions, rendering, QA, approvals, schedule,
publishing, account health, analytics observations and audit events. List queries
are scoped to one client, ordered deterministically and limited to 25 rows per
page; page numbers are capped at 100. Dates use the client's configured timezone.

## Access

Navigation and server routes both enforce section permissions. Owners,
administrators, content managers and viewers can read all sections. Editors can
read production and review sections; reviewers can read projects, versions, QA
and approvals; analysts can read analytics only. Viewers have no mutations.

Owners and administrators can start or renew Instagram authorization through the
existing server-side OAuth route. Owners, administrators and content managers can
manually reconcile publishing queue entries only when Redis is configured, the
job remains `SCHEDULED` or `RETRY_WAIT`, it is below the attempt limit and no
provider container/media ID exists. The server action repeats authorization and
client-scoped state checks. It records the operator, queue result and job ID in
the audit timeline. It does not transition `NEEDS_ATTENTION` or replay an
ambiguous provider publish.

## Verification and limits

Run `npm run lint -w @forge/web`, `npm run typecheck -w @forge/web` and
`npm run build -w @forge/web` after installing dependencies. The web build uses
the supported Next.js Webpack option because this Windows environment denies
Turbopack's PostCSS worker process. Verify a signed-in session and each role in
a staging environment backed by the migrated database before production use.

Analytics currently displays stored provider observations. Trend, comparison and
account summaries depend on Phase 13 collection. Publication state remains
dispatch-only until the Meta Instagram Login publishing contract is verified and
Phases 11.5–11.7 are implemented.
