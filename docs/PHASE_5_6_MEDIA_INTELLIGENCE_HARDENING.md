# Phase 5.6 — Media Intelligence Hardening

Phase 5.6 hardens the completed media-intelligence pipeline before Reel Planning.

## Changes

- Preparation is stage-aware: callers can independently disable frame or audio extraction.
- Transcription extracts audio only and no longer creates an unused representative frame.
- Scene detection downloads/probes the source only and no longer creates unused frames or normalized audio.
- Semantic understanding keeps representative frames but skips unused normalized audio.
- Permanent malformed-media failures are separated from transient tool/infrastructure failures.
- Only permanent media failures mark a `MediaAsset` as `INVALID`; transient failures restore its previous stable state.
- Transcription reuses a compatible persisted provider/model result unless `force: true` is supplied.
- Semantic understanding reuses a compatible persisted provider/model result unless `force: true` is supplied.
- Cached AI reruns do not create duplicate usage or provenance records.

## Permanent invalid-media codes

- `MEDIA_DOWNLOAD_INVALID`
- `FFPROBE_INVALID_JSON`
- `VIDEO_STREAM_MISSING`
- `AUDIO_STREAM_MISSING`

Timeouts, process failures, provider failures, network failures, and unknown failures are not evidence that source media is invalid.

## Acceptance

1. Typecheck, lint, tests, build, and formatting pass.
2. Cached transcription and semantic reruns return persisted results.
