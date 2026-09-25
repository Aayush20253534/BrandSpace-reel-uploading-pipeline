# Phase 5.2 — Representative Frames and Normalized Audio

Phase 5.2 extends deterministic media preparation without introducing an AI provider.

## Behavior

- Downloads the source asset from the configured `MediaStorage`.
- Probes it with `ffprobe`.
- For video, extracts deterministic representative JPEG frames.
- For media with audio, extracts mono 16 kHz PCM WAV suitable for later transcription.
- Keeps derivatives ephemeral by default.
- Executes a caller-provided consumer while the temporary workspace exists.
- Deletes the entire temporary workspace in `finally`, including when the consumer fails.
- Does not create Drive derivative clutter or new database rows.
- Does not record AI usage because this stage performs no AI inference.

The default four frame positions are 10%, 35%, 60%, and 85% of the clip duration. Very short clips use one midpoint frame.

## Local smoke test

```powershell
npm run media:prepare -- <media-asset-id>
```

To copy the ephemeral outputs somewhere for manual inspection before cleanup:

```powershell
npm run media:prepare -- <media-asset-id> .\tmp\media-inspection
```

The copied inspection directory is only a developer aid and should not be committed.

## Production integration

`withPreparedMediaAsset()` is intentionally callback-based. Phase 5.3 can transcribe the normalized WAV while it exists, and later semantic analysis can consume the representative frames in the same workspace. The source and intermediates are removed after the callback completes.

No Prisma migration is required for Phase 5.2.
