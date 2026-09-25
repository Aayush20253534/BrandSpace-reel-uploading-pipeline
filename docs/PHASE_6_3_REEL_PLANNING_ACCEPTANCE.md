# Phase 6.3 — Reel Planning CLI and Live Acceptance

Phase 6.3 adds operator-facing commands for exercising the Phase 6 planning pipeline against real PostgreSQL data and the live Groq provider.

## Commands

Create a DRAFT ReelProject:

```powershell
npm run reel:create -- <client-id> "<title>" "<objective>"
```

Plan the project:

```powershell
npm run reel:plan -- <reel-project-id>
```

Inspect persisted acceptance evidence:

```powershell
npm run reel:inspect -- <reel-project-id>
```

## Acceptance criteria

A successful live run must show:

1. the ReelProject moves from `DRAFT` to `PLANNED`;
2. `activeVersion` becomes `1`;
3. one immutable ReelVersion is created;
4. ReelSource rows point only to the client's analyzed media and use deterministic candidate boundaries;
5. the blueprint persisted in ReelVersion matches the planned source lineage;
6. AiProvenance records `operation = reel.plan`, provider, model, prompt version, structured output, and latency;
7. UsageLedger records AI input/output units for the same ReelProject.

The CLI reads `GROQ_API_KEY` from `.env` and optionally accepts `GROQ_REEL_PLANNING_MODEL`. It never prints credentials.

## Failure handling

If the provider or deterministic validator rejects a plan, the ReelProject remains unplanned and no ReelVersion is created. Provider retries, concurrency/idempotency hardening, and transactional AI bookkeeping are deferred to Phase 6.4.
