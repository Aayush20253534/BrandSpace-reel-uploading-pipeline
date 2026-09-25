# Phase 5.4 — Deterministic Scene Detection

Phase 5.4 detects visual cuts locally with FFmpeg and turns them into deterministic scene boundaries and ranked candidate segments.

## Design

- Scene detection is deterministic and does not call an AI provider.
- FFmpeg's scene score identifies visual cut points.
- Cut points become contiguous `SceneBoundary` records spanning the full video.
- Very short or excessively long scenes are excluded from initial usable-segment candidates.
- Candidate scores combine duration fit with visual-cut confidence.
- Results are persisted in the existing `MediaAnalysis.scenes` and `MediaAnalysis.usableSegments` JSON fields.
- No Prisma migration or new dependency is required.
- Phase 5.5 can enrich these deterministic boundaries with transcript and multimodal semantics.

## Run

```powershell
npm run media:scenes -- <media-asset-id>
```

## Acceptance

A successful live run must:

1. download and prepare a real `RAW_VIDEO`;
2. determine its duration with ffprobe;
3. detect visual cuts with FFmpeg;
4. create contiguous scene boundaries;
5. rank duration-valid candidate segments;
6. persist scenes and usable segments to the latest `MediaAnalysis`;
7. clean the temporary workspace.
