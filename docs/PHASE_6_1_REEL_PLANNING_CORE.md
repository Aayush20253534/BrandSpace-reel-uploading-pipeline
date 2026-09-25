# Phase 6.1 — Reel Planning Core

Phase 6.1 establishes the deterministic boundary between analyzed source media and AI-assisted reel planning.

## Responsibilities

- Load a DRAFT or REVISION_REQUESTED ReelProject and its BrandProfile.
- Discover analyzed RAW_VIDEO assets belonging to the same client.
- Convert persisted usable segments into deterministic planning candidates.
- Expose a provider-neutral ReelPlanningProvider contract.
- Require the provider to select exact candidate boundaries rather than invent timestamps.
- Validate the returned blueprint before persistence.
- Persist an immutable ReelVersion and ordered ReelSource lineage.
- Move the ReelProject to PLANNED and update activeVersion.
- Record AI provenance and usage accounting.

## Safety boundary

The planning provider may decide editorial ordering, role, hook, caption, CTA, and purpose. It may not invent source media IDs or source timestamps. Every selected clip must exactly match a deterministic candidate produced by media intelligence.

## Deferred to Phase 6.2

- Live Groq structured-output adapter.
- CLI/live acceptance workflow.
- Prompt construction and brand-policy enforcement beyond the core context contract.
- Retry/backoff around provider calls.
