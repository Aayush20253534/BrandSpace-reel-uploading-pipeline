# Phase 8.2 — Deterministic Creative QA

Phase 8.2 extends the Phase 8.1 `QaReview` with deterministic creative and brand-policy
checks. It deliberately does not use an AI model: objective policy failures should be
reproducible and cheap.

## Checks

`creative-qa-v1` verifies:

- the planned hook is present;
- every selected clip has a non-empty creative purpose;
- generated reel text does not contain configured banned words;
- generated reel text does not explicitly contain configured forbidden topics.

The scan covers the hook, persisted caption, CTA, and clip purposes. Matching is
case-insensitive and deterministic.

## Workflow

Creative QA requires an existing technical `QaReview` with `decision = PASS`.

A passing creative review enriches the existing `QaReview.creative` field and leaves
the current approval state unchanged. A failing review sets
`QaReview.decision = NEEDS_REVISION`; when the project is `AWAITING_APPROVAL`, it also
moves the project to `REVISION_REQUESTED`.

Repeated invocation is idempotent: once `creative` is populated, the existing result
is returned.

This phase does not pretend substring matching can judge subjective creative quality.
AI-assisted scoring and human review can be layered later without weakening these
deterministic policy gates.

## Acceptance

```powershell
npm run reel:qa:creative -- <reel-version-id>
```

For a compliant Phase 8.1 reel, expect `[reel:qa:creative] review complete` and a PASS.
Run the command again and expect `[reel:qa:creative] review already exists`.
