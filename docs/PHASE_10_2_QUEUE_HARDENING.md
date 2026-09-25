# Phase 10.2 — Queue Reliability and Reconciliation

Phase 10.2 hardens the PostgreSQL-to-BullMQ boundary introduced in Phase 10.1.

## Guarantees

PostgreSQL remains the source of truth for publishing intent. Redis/BullMQ remains
delivery infrastructure only.

The worker now reconciles pending PostgreSQL publishing jobs into BullMQ on startup
and every 60 seconds. Reconciliation scans `SCHEDULED` and `RETRY_WAIT` jobs inside a
24-hour lookahead window and uses the deterministic queue job ID from Phase 10.1.

This closes the failure window where the PostgreSQL transaction succeeds but the
subsequent Redis enqueue fails.

## Retry bookkeeping

BullMQ dispatch jobs still receive five attempts with exponential backoff.

When a queue attempt fails:

- non-final failures move the PostgreSQL job to `RETRY_WAIT`;
- the attempt count and error are persisted;
- the next BullMQ attempt may atomically claim either `SCHEDULED` or `RETRY_WAIT`;
- exhausting the queue attempt budget moves the publishing job to
  `NEEDS_ATTENTION`.

A successful dispatch clears the queue error fields and records the successful attempt
number.

## Failed Redis job repair

The automatic reconciler inspects deterministic BullMQ jobs but does not reset an
exhausted retry budget. If Redis reports a terminal `failed` job while PostgreSQL still
has the intent pending, the database job is moved to `NEEDS_ATTENTION`.

The manual reconciliation command is the explicit repair path for a `failed` or
invalid Redis record while its PostgreSQL intent is still `SCHEDULED`/`RETRY_WAIT`.
It removes the stale Redis record and recreates it with a fresh retry budget.

`NEEDS_ATTENTION` jobs are intentionally not auto-repaired. An operator must decide
whether they are safe to retry.

If BullMQ says a job is already `completed` while PostgreSQL still says the same intent
is pending, the database job is moved to `NEEDS_ATTENTION` with
`QUEUE_DB_STATE_MISMATCH` rather than risking a duplicate dispatch.

## Operator reconciliation

Run a manual reconciliation at any time:

```powershell
npm run reel:queue:reconcile
```

Optionally limit the batch:

```powershell
npm run reel:queue:reconcile -- 100
```

The manual command scans up to 250 jobs by default and reports whether each queue job
was already present, newly enqueued, or repaired.

## Observability

The worker emits structured events for:

- queue reconciliation;
- active dispatch attempts;
- completed dispatch jobs;
- failed dispatch attempts;
- exhausted retry budgets;
- stalled jobs;
- queue/database state mismatches;
- reconciliation failures.

## Acceptance

1. Typecheck and test `@forge/queue` and `@forge/worker`.
2. Run `npm run reel:queue:reconcile` with Redis available.
3. Confirm a pending PostgreSQL job missing from Redis is recreated.
4. Confirm duplicate reconciliation does not create duplicate BullMQ jobs.
5. Confirm a normal scheduled job still transitions to `DISPATCHED`.
6. Run the full repository verification suite.

Phase 10.2 deliberately stops at the dispatch boundary. Phase 11 adds the real
multi-client Instagram `SocialAccount` model, credential lifecycle, public media
delivery, Meta container creation/status polling, and `media_publish`.
