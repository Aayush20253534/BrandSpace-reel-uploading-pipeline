# Phase 10.1 — Durable Scheduling and BullMQ Dispatch

Phase 10.1 introduces the queue boundary without making Redis the source of truth.

## Architecture

PostgreSQL owns the durable `PublishingJob`. Redis/BullMQ is delivery infrastructure.

Scheduling first commits the `PublishingJob`, project transition, and audit event in one
serializable PostgreSQL transaction. It then enqueues a deterministic BullMQ delayed
job. If enqueueing fails after the database commit, rerunning the same scheduling
command reuses the same database row and retries the same queue job ID.

The worker claims only `SCHEDULED` rows and moves them to `DISPATCHED`. Phase 11 will
replace the dispatch boundary with the Meta/Instagram publishing implementation.

BullMQ delayed jobs are intentionally used instead of a legacy QueueScheduler. Current
BullMQ releases handle delayed/stalled work without requiring QueueScheduler.

## Queue policy

- Queue: `forge-publishing`
- Job: `publishing.dispatch`
- deterministic queue job ID derived from `PublishingJob.id`
- five attempts with exponential backoff
- worker concurrency: 4
- PostgreSQL remains authoritative

## Acceptance

Configure `REDIS_URL`, then:

```powershell
npm run reel:schedule -- <reel-project-id> <social-account-id> <future-iso-time>
npm run dev --workspace=@forge/worker
```

Run the same schedule command twice before dispatch. The second invocation must reuse
the same `PublishingJob` and queue job ID.

When the delayed job becomes due, the worker atomically moves the database row from
`SCHEDULED` to `DISPATCHED`.
