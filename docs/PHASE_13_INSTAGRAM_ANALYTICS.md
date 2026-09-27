# Instagram analytics collection

The read-only insights collector is disabled by default. It uses the connected
Instagram Login user token and a pinned Graph version. It asks for only the
metric names supplied in `INSTAGRAM_REEL_INSIGHTS_METRICS`; the repository does
not guess a default list. Enable it only after confirming the current official
Instagram Login Reel insights endpoint, permission and supported metric names.

For every `PUBLISHED` job from the last 30 days with an external media ID, the
worker creates one `AnalyticsCollection` row. It captures at about one hour
after publication, every six hours through day seven, then daily through day 30. Each attempt reserves a stable `captureStartedAt` before the provider read,
so retries cannot overwrite or duplicate the same snapshot. HTTP 429 and
transient failures receive bounded backoff; authentication failures move the
social account to `NEEDS_REAUTH`; repeated or permanent failures move the
collection to `NEEDS_ATTENTION`. The worker checks account and client ownership
before every request and has a bounded scan of 25 due rows per minute.

`ReelAnalyticsSnapshot.metrics` stores a `instagram-insights-v1` envelope with
the requested names, provider-returned `data` array, Graph version and actual
collection time. The existing `capturedAt` column is the stable attempt start
time. The dashboard displays only numeric values present in the provider
response and labels them as provider metrics. It does not derive engagement
scores or compare incompatible windows.

An owner/admin can inspect or retry a collection after fixing credentials or
the metric configuration. Retry keeps the reserved attempt timestamp and does
not overwrite an existing snapshot:

```text
npm run instagram:insights:reconcile -- status <collection-id>
npm run instagram:insights:reconcile -- retry <collection-id> <owner-or-admin-user-id>
```

After applying migration `20260927020000_analytics_collection` in staging,
set `INSTAGRAM_REEL_INSIGHTS_METRICS` to a comma-separated list of 1–12 metric
names verified against the exact current Meta reference, then set
`INSTAGRAM_INSIGHTS_ENABLED=true` on the worker. Run a staging account with a
known published Reel and inspect two snapshots and their audit events. No live
insights request or migration has run from this workspace.
