# Phase 6.2 — Groq Reel Planning Provider

Phase 6.2 connects the provider-neutral Phase 6.1 planning core to Groq Structured Outputs.

## Provider

- Groq through its OpenAI-compatible API.
- Default model: `qwen/qwen3.8-27b`.
- Strict JSON Schema output.
- Reasoning disabled for this editorial planning call.

## Safety boundary

The model may choose editorial ordering, roles, hook, caption, CTA, and purpose. It must copy media IDs and source boundaries exactly from deterministic candidates. Phase 6.1 validation remains authoritative and rejects invented or modified source references.

Candidate transcripts and semantic metadata are treated as untrusted source data rather than instructions.

## Brand context

The provider receives the BrandProfile fields already loaded by Phase 6.1, including positioning, audience, pain points, content pillars, tone, preferred hooks, forbidden topics, preferred/banned words, CTA rules, reel style, and compliance rules.

## Deferred to Phase 6.3

- Operator CLI and real ReelProject creation/planning.
- Live Groq acceptance against BrandSpace media.
- Database verification of ReelVersion, ReelSource, AiProvenance, and UsageLedger.
