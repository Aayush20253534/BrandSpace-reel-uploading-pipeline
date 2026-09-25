# Phase 5.1 — Deterministic Media Preprocessing

This slice establishes the non-AI foundation for media intelligence.

## What it does

- Verifies `ffmpeg` and `ffprobe` availability.
- Downloads a Drive-backed `RAW_VIDEO` or `AUDIO` asset into an isolated OS temp directory.
- Uses `ffprobe` JSON output to extract duration, dimensions, codecs, frame rate, format, bitrate, and stream presence.
- Persists technical metadata to `MediaAsset`.
- Creates or reuses the latest `MediaAnalysis` record and records `RUNNING`, `SUCCEEDED`, or `FAILED`.
- Moves the asset through `ANALYZING` to `ANALYZED`, or `INVALID` on deterministic preprocessing failure.
- Deletes temporary source files in a `finally` block.
- Spawns FFmpeg tools directly without a shell and enforces time/output limits.

## Local prerequisites

Install FFmpeg so both commands are available:

```powershell
ffmpeg -version
ffprobe -version
```

If they are not on `PATH`, set these in `.env`:

```env
FFMPEG_PATH=C:\path\to\ffmpeg.exe
FFPROBE_PATH=C:\path\to\ffprobe.exe
```

Do not commit machine-specific paths.

## Smoke test

```powershell
npm install
npm run media:check
```

Get the ingested `MediaAsset.id` from the database, then:

```powershell
npm run media:analyze -- <media-asset-id>
```

Expected result: the asset becomes `ANALYZED`, dimensions/duration are populated, and its latest `MediaAnalysis` is `SUCCEEDED`.

## Deliberately not in 5.1

Representative frame extraction, audio extraction, transcription, scene boundaries, multimodal AI understanding, provenance/cost accounting, and queue-driven retries belong to the next Phase 5 slices. Keeping the deterministic probe boundary separate makes failures diagnosable before paid/AI work is introduced.
