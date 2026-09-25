# Phase 7.1 — Deterministic Rendering Foundation

Phase 7.1 turns an immutable `ReelVersion` and its ordered `ReelSource` lineage into
a deterministic MP4 render.

## Render contract

- Ordered `ReelSource` rows are the only source-selection authority.
- Source timestamps come from persisted deterministic planning output.
- Output profile is versioned as `reel-render-v1`.
- Default output is 1080x1920, 30 fps, H.264 video, AAC stereo audio and
  `yuv420p` pixel format.
- Landscape/square sources are scaled to cover and center-cropped to 9:16.
- Clips without an audio stream receive deterministic stereo silence.
- Repeated clips from the same media asset reuse one local download.
- FFmpeg is invoked without a shell and with bounded stderr capture and timeout.

## Persistence

The acceptance CLI creates a `RenderJob`, moves the project from `PLANNED` to
`RENDERING`, and records deterministic render metadata on success. Failures mark the
job `FAILED` and project `RENDER_FAILED`.

Phase 7.1 intentionally writes the rendered MP4 to an operator-provided local path.
Durable generated-artifact upload, `MediaAsset(kind=GENERATED_REEL)`, and
`ReelVersion.renderedAssetId` binding belong to Phase 7.2. The project therefore
remains `RENDERING` after a successful Phase 7.1 render; it must not advance to QA
until a durable artifact exists.

## Acceptance

Use a planned reel version:

```powershell
npm run reel:render -- <reel-version-id> .\artifacts\phase7-1-reel.mp4
```

Inspect the emitted probe. A successful acceptance requires a non-empty MP4 with
video, audio, 1080x1920 dimensions, and duration close to the sum of selected source
clip durations.
