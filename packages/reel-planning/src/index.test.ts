import assert from "node:assert/strict";
import test from "node:test";
import {
  REEL_BLUEPRINT_VERSION,
  ReelPlanningError,
  type ReelBlueprint,
  type ReelSourceCandidate,
  validateReelBlueprint,
} from "./index";

const candidate: ReelSourceCandidate = {
  mediaAssetId: "asset-1",
  sceneIndex: 3,
  startMs: 2_000,
  endMs: 7_000,
  durationMs: 5_000,
  score: 0.9,
  summary: "Product demonstration",
  transcript: "A grounded transcript",
  tags: ["demo"],
  subjects: ["product"],
};

const blueprint = (): ReelBlueprint => ({
  schemaVersion: REEL_BLUEPRINT_VERSION,
  title: "Demo reel",
  objective: "Explain the product",
  targetDurationMs: 5_000,
  hook: "See how it works",
  caption: "A short demo",
  cta: "Learn more",
  clips: [
    {
      mediaAssetId: candidate.mediaAssetId,
      sceneIndex: candidate.sceneIndex,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      role: "HOOK",
      purpose: "Open with the strongest source segment",
    },
  ],
});

test("accepts a blueprint grounded in deterministic source candidates", () => {
  assert.deepEqual(
    validateReelBlueprint(blueprint(), [candidate]),
    blueprint(),
  );
});

test("rejects timestamps invented by the planning provider", () => {
  const invalid = blueprint();
  invalid.clips[0] = { ...invalid.clips[0]!, startMs: 2_001 };

  assert.throws(
    () => validateReelBlueprint(invalid, [candidate]),
    (error: unknown) =>
      error instanceof ReelPlanningError &&
      error.code === "REEL_BLUEPRINT_SOURCE_INVALID",
  );
});

test("rejects duplicate source selections", () => {
  const invalid = blueprint();
  invalid.clips.push({ ...invalid.clips[0]!, role: "BODY" });

  assert.throws(
    () => validateReelBlueprint(invalid, [candidate]),
    (error: unknown) =>
      error instanceof ReelPlanningError &&
      error.code === "REEL_BLUEPRINT_SOURCE_DUPLICATE",
  );
});

test("rejects unreasonable target durations", () => {
  const invalid = blueprint();
  invalid.targetDurationMs = 999;

  assert.throws(
    () => validateReelBlueprint(invalid, [candidate]),
    (error: unknown) =>
      error instanceof ReelPlanningError &&
      error.code === "REEL_BLUEPRINT_DURATION_INVALID",
  );
});
