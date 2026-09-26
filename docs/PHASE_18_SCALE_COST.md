# Phase 18 scale and cost review

The current code has bounded dashboard and MCP reads, durable idempotency keys,
worker dispatch claims and temporary media cleanup. It has not been load tested
with thousands of customers. The deployment topology, traffic distribution,
Drive download volume, provider quotas and media sizes are unknown, so the
numbers below are assumptions to verify in staging.

## Database

Migration `20260926040000_hot_query_indexes` adds client/date indexes for
media, projects, accounts and audit lists, and extends the pending publishing
index to the reconciliation sort order. It removes the two shorter indexes that
the new indexes replace. The operator dashboard limits list queries to 26 rows
and at most 100 offset pages; MCP limits them to 50 rows and 100 pages. Offset
pagination beyond a few thousand rows per client should be replaced with
date-plus-ID cursors. Version, QA, approval, publishing and analytics lists
still filter client ownership through joins; use staging `EXPLAIN` plans before
denormalizing tenant keys or adding more indexes. Avoid indexing every column:
each extra index raises ingest and write costs.

The migration uses normal PostgreSQL index builds, so schedule it when write
traffic is low and measure lock time in staging. Do not apply it blindly to a
large live database. Audit records, AI provenance, usage ledger entries and
publishing history need an explicit legal retention policy before deletion.
Analytics snapshots should eventually roll up to daily summaries before raw
snapshot pruning; the collection pipeline is pending, so no destructive
retention job is added.

## Workers and provider quotas

The publishing queue is one BullMQ queue with concurrency 4 per worker
instance. Reconciliation scans 250 due jobs every minute with a 24-hour
lookahead. At 1,000 due jobs, a single pass covers only 250, so several cycles
are needed; high-volume clients can dominate the shared queue. Before live
scale, implement per-client fairness and provider quotas using the current
Instagram Login contract, then test that one client cannot starve another.
The worker's idempotency and preflight guards prevent unsafe duplicate claims,
but provider-side idempotency cannot be verified until publication is
implemented. Stale leases and restart behavior require a staging crash test.

## Media and AI

Google Drive remains canonical. The temporary publication bucket holds only
short-lived delivery copies; the worker cleans expired objects every 30
minutes and the proposed bucket lifecycle rule deletes `publication/` after
three days as a fallback. Track bytes uploaded, duplicate Drive downloads,
signed URL fetch failures and cleanup lag before increasing throughput.
Cap concurrent FFmpeg jobs by measured CPU, RAM and disk, and cache unchanged
Drive revisions where rights allow. AI provenance and usage ledger records
exist; establish budgets per client/model and inspect retry duplication before
automating model selection. No provider prices are assumed in code.

## Staging acceptance workload

1. Seed representative staging clients with skewed asset and reel counts (a
   few large clients and many small ones), never production customer media.
2. Apply the index migration in staging and compare `EXPLAIN (ANALYZE,
BUFFERS)` for the dashboard/MCP list queries and worker reconciliation
   before and after. Record p50/p95 response times and lock duration.
3. Run `npm run scale:mcp-load` with a staging read-only agent credential. Its
   synthetic requests exercise MCP authentication, role discovery and the
   per-credential rate limit without creating reels or publishing.
4. Simulate Redis loss and worker restart, then inspect queue reconciliation,
   stale locks and duplicate dispatch attempts. Test temporary media cleanup
   with a private staging bucket.
5. Set alert thresholds only after observing staging baselines. At minimum
   track pending publishing age, queue reconciliation lag, token refresh
   failures, temporary bytes/age, and per-client AI cost.

No production scale run or provider-backed load test has been performed from
this workspace.
