# Phase 11.4 — Temporary publication media delivery

## Design

Google Drive remains the canonical binary store. A `PublishingJob` may request only
the `READY` `GENERATED_REEL` attached to its own `ReelVersion`. The worker checks
the client, social account, render provenance, MIME type, size, Drive revision and
canonical metadata before moving that MP4 to a **private** S3-compatible bucket.
The operational size cap is 512 MiB.

`PublicationMediaDelivery` records the job, source asset, deterministic object key,
size, state, lease and expiry. It stores neither the binary nor the signed URL.
The private object receives a signed GET URL lasting at most 24 hours. The object
record expires after 48 hours. Published or expired objects are removed by the worker at startup
and every 30 minutes. A crashed upload can be resumed by inspecting the same
deterministic key. Preparation leases prevent routine duplicate transfers.

The bucket should remain private. Cloudflare R2 presigned URLs use its S3 API
endpoint; they do not use a custom domain. See [R2 presigned URL guidance](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Configuration

Set `PUBLICATION_S3_ENDPOINT`, `PUBLICATION_S3_REGION`,
`PUBLICATION_S3_BUCKET`, `PUBLICATION_S3_ACCESS_KEY_ID`, and
`PUBLICATION_S3_SECRET_ACCESS_KEY` in the worker's private environment. For R2,
the region is `auto` and the endpoint is the account-specific HTTPS S3 API origin.
The credential needs object read/write access scoped to this one bucket.

The bucket should have a lifecycle rule deleting objects under `publication/`
after three days. This is a safety net if workers remain offline past the 48-hour
application cleanup deadline.

## Acceptance

1. Install dependencies, generate Prisma Client, build the workspaces and apply migration
   `20260926000000_phase11_4_publication_media_delivery` to a non-production
   database first.
2. Configure a private test bucket and test credential.
3. With a dispatched, rendered test reel, run
   `npm run publication:media -- prepare <publishing-job-id>`. The command prints
   the delivery record without the signed URL.
4. Run `npm run publication:media -- probe <publishing-job-id>` to fetch the
   signed URL without printing it. Confirm an HTTP 200 `video/mp4` response with
   the expected content length. From a separate unauthenticated network, repeat
   this probe if your deployment network could mask public reachability. Confirm
   an unsigned GET is denied.
5. Repeat preparation and confirm the same object key is reused and the canonical
   asset is not redownloaded.
6. Simulate a crash after upload and before the `READY` database update. Clear or
   expire the lease, retry and confirm the existing object is recovered.
7. Advance expiry in a test database, run
   `npm run publication:media -- cleanup` and confirm the remote object is
   deleted and the row is `DELETED`.

No live bucket acceptance was performed in this change because S3 publication
credentials are not configured in the local environment.
