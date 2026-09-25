# Phase 5.5 — Multimodal Semantic Understanding

Phase 5.5 combines representative video frames, the persisted transcript, and deterministic scene boundaries into structured media understanding for the Reel Planner.

## Design

- Provider-neutral `SemanticAnalysisProvider` contract keeps the media domain independent from Groq.
- The current CLI adapter uses Groq's OpenAI-compatible API with `qwen/qwen3.8-27b`.
- Exactly three 768px representative frames are sent to stay inside the provider's current three-image request limit.
- The persisted transcript and Phase 5.4 scene boundaries are supplied as grounding context.
- Strict JSON Schema output is requested and normalized defensively before persistence.
- Existing deterministic `scenes` and `usableSegments` are not overwritten.
- `MediaAnalysis.summary`, `tags`, `subjects`, `visual`, and `quality` receive semantic enrichment.
- `AiProvenance` records provider/model, prompt version, structured output, confidence, and latency.
- `UsageLedger` records AI token usage when the provider returns it.
- No Prisma migration or new dependency is required.

## Run

```powershell
npm run media:understand -- <media-asset-id>
```

Optional model override:

```powershell
$env:GROQ_VISION_MODEL="qwen/qwen3.8-27b"
```

## Prerequisites

For the target video, run Phase 5.3 transcription and Phase 5.4 scene detection first.

## Acceptance

A successful live run must:

1. reuse the latest `MediaAnalysis`;
2. prepare three representative frames;
3. combine frames, transcript, and scene boundaries;
4. obtain schema-constrained multimodal understanding;
5. persist summary, tags, subjects, semantic visual/content data, quality scores, and semantic scene descriptions;
6. write AI provenance and usage records;
7. leave deterministic scene boundaries and candidate segments intact;
8. clean the temporary workspace.
