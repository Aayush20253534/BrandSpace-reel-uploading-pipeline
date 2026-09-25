# Phase 5.3 — Transcription

Phase 5.3 adds provider-neutral speech-to-text on top of the deterministic audio preparation from Phase 5.2.

## Design

- `TranscriptionProvider` keeps the media pipeline independent of one AI vendor.
- The first adapter targets Groq's OpenAI-compatible transcription endpoint.
- Audio remains ephemeral and is deleted by `withPreparedMediaAsset()`.
- Transcript and detected language are persisted on the latest `MediaAnalysis`.
- Timestamped provider segments are persisted under `MediaAnalysis.quality.transcription`.
- Each successful or failed provider invocation records a `UsageLedger` entry with `kind=TRANSCRIPTION`.
- No Prisma migration is required because the Phase 3 schema already contains transcript, language, JSON quality metadata, and UsageLedger.

## Environment

Add these locally to `.env` and never commit the file:

```env
GROQ_API_KEY=
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
```

The model is configurable so a later provider/model change does not leak through the domain layer.

## Run

```powershell
npm run media:transcribe -- <media-asset-id>
```

An optional ISO-639-1 language hint can be supplied:

```powershell
npm run media:transcribe -- <media-asset-id> en
```

Omit the hint when automatic language detection is desired.

## Acceptance

A successful live run must:

1. download and prepare the source media;
2. create normalized 16 kHz mono audio;
3. transcribe through the configured provider;
4. persist transcript and language on `MediaAnalysis`;
5. persist transcription metadata and segments;
6. create a `UsageLedger` row;
7. clean the temporary workspace.
