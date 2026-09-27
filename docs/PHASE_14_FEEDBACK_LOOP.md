# Phase 14 feedback loop

## Data contract

`ReelFeedbackObservation` is an append-only, client-scoped materialization. A
`reel-feedback-v1:version:<id>` row records the immutable blueprint and ordered
source lineage for one reel version. A `reel-feedback-v1:snapshot:<id>` row also
links the exact publishing job and analytics snapshot. The unique `sourceKey`
and `createMany(..., skipDuplicates: true)` make repeated syncs idempotent.
Changing the extractor requires a new schema version and new source keys; a
backfill never updates an earlier observation or its ReelVersion.

The feature extractor records duration band, hook punctuation form, CTA category,
ordered source asset IDs and section roles, pacing from known clip bounds,
objective and its provenance, campaign key at sync, and scheduled and actual
posting timestamps. Unknown content pillar and subtitle usage are represented
as `UNLABELED` and `UNRECORDED`. Current project fields are explicitly marked
as values at sync time. It never turns missing source fields into guesses.

Provider metrics are copied unchanged from an analytics snapshot and kept apart
from derived features. The Instagram insights collector is disabled until a
verified metric allowlist is configured. Therefore no engagement score, hook
performance rank, causal claim, or optimization on views is produced. The
read-only `list_feedback_observations` MCP tool returns features and linkage;
`list_analytics_snapshots` separately exposes provider-returned metrics.

## Backfill and planning

After deploying migration `20260926060000_reel_feedback_observations` and
building the domain package, run `npm run feedback:sync -- <client-id>` from a
trusted operator shell. The command scans versions and snapshots in batches of
100, checks source client ownership, writes one audit event per inserted batch,
and prints scanned and inserted counts. Run it for each client after new versions
or snapshots are created. The command has not been run against a live database.

Planning reads the 20 most recent version observations for the same client and
supplies bounded source reuse and duration counts as context for variety. The
planner receives no raw provider metrics. AI provenance records the observation
IDs and prompt version `reel-planning-prompt-v3`, so an operator can trace what
historical context was available. The planner must not infer that frequent
creative choices performed better.

## Next acceptance gate

Once the Instagram Login insights contract is verified and real snapshots are
collected, define each provider metric, denominator, collection window, and
eligibility threshold before adding deterministic performance aggregation.
Compare cohorts only when their metrics and windows are compatible. This gate
also needs a staging backfill and a review of the resulting observations.
