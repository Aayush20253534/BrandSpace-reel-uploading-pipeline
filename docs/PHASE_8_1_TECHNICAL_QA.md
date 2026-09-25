# Phase 8.1 — Deterministic Technical QA

Phase 8.1 introduces deterministic quality gates for durable generated reels before
human approval or publishing.

## Checks

`technical-qa-v1` verifies:

- MIME type is `video/mp4`;
- artifact is non-empty;
- dimensions are exactly 1080x1920;
- actual duration is within max(250 ms, 5%) of the blueprint target duration;
- a video stream exists;
- an audio stream exists.

The QA engine is deterministic. No AI model decides whether a technically invalid
artifact may proceed.

## Persistence and workflow

`npm run reel:qa -- <reel-version-id>` requires:

- project state `QA`;
- a bound `renderedAssetId`;
- a READY `GENERATED_REEL`;
- at least one successful RenderJob.

It creates one `QaReview` containing the full technical check result.

On PASS:

- `ApprovalMode.AUTO` advances to `APPROVED`;
- `REQUIRED` and `OPTIONAL` advance to `AWAITING_APPROVAL`.

On FAIL, the project remains in `QA` so an operator can inspect the failed checks.
A later rendering/revision workflow can decide whether to re-render or revise the
creative plan.

Repeated invocation after a review exists returns the existing review instead of
creating duplicates.

## Acceptance

```powershell
npm run reel:qa -- <reel-version-id>
```

For the current 1080x1920 Phase 7.2 artifact, all six checks should pass and the
BrandSpace client should advance to `AWAITING_APPROVAL` because its approval mode is
REQUIRED.
