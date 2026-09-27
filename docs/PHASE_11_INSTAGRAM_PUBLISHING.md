# Instagram publishing controller

The worker can advance a dispatched job through container creation, status
polling, `media_publish`, and remote-media verification using Instagram Login
tokens on `graph.instagram.com`. The provider client accepts a pinned Graph
version. The worker uses the exact rendered reel, its version caption, a private
temporary delivery object with a signed HTTPS URL, and the connected account's
encrypted token. It requires a human `APPROVED` record for the exact version even
when a client's general approval mode is automatic.

The controller is disabled by default. Set `INSTAGRAM_LIVE_PUBLISH_ENABLED=true`
only after reviewing the current official Instagram Login content-publishing
contract, staging migration and mock acceptance, account permissions, bucket
delivery, and a specific approved test reel. This repository does not enable
the switch or make a live publish.

## Durable sequence

1. BullMQ dispatch claims a pending job in PostgreSQL and releases its lock.
2. The lifecycle claims one `DISPATCHED` or `PROCESSING` row by lock and due time.
3. It checks client, account, active version, rendered artifact and exact-version
   human approval again. It prepares temporary media from Google Drive.
4. It persists `containerCreateIntentAt` **before** the remote create call. A
   returned container ID is stored before any status poll.
5. It polls no more than 60 times at 30-second intervals, with backoff for
   rate limits and transient read failures. Only `FINISHED` can advance.
6. It persists `publishIntentAt` **before** the one remote publish call. A
   returned media ID is stored before remote verification.
7. It verifies the media by ID, then marks the job and project `PUBLISHED` in
   one database transaction and writes an audit event.

An uncertain create or publish outcome moves the job to `NEEDS_ATTENTION`.
No worker automatically repeats a write whose request might have reached Meta.
Queue reconciliation and dispatch also reject any pending row with a stored
remote-write intent or exhausted dispatch attempts.
This can leave a job awaiting reconciliation even if a remote action succeeded;
that is safer than creating a duplicate post. Only a verified media ID can be
attached to an ambiguous publish through the owner/admin reconciliation CLI.
The CLI checks the remote reel product, exact caption, and posting window, and
audits the actor. It never calls `media_publish`.

```text
npm run instagram:publish:reconcile -- status <job-id>
npm run instagram:publish:reconcile -- confirm-media <job-id> <remote-media-id> <owner-or-admin-user-id>
```

## Acceptance still required

The official Instagram Login publishing reference was inaccessible from this
workspace. Meta's publicly browseable Postman Reels examples belong to the
Facebook Login/Page-token flow and are not evidence for Instagram Login. Review
the exact Instagram Login endpoint, fields, status values, limits and error
contract in the current official reference before enabling live publication.
Then run the mocked and staging scenarios in the brief, including 429, 5xx,
crash after remote publish, replay, account revocation and two-client isolation.
No live database migration, Meta test, or real post has occurred here.
