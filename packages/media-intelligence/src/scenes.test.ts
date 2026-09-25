import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildScenes,
  parseSceneChangeOutput,
  rankUsableSegments,
} from "./scenes";

test("parseSceneChangeOutput reads FFmpeg metadata timestamps and scores", () => {
  const stderr = [
    "[Parsed_metadata_1] frame:0 pts:1000 pts_time:1.250",
    "[Parsed_metadata_1] lavfi.scene_score=0.420000",
    "[Parsed_metadata_1] frame:1 pts:2000 pts_time:4.750",
    "[Parsed_metadata_1] lavfi.scene_score=0.810000",
  ].join("\n");

  assert.deepEqual(parseSceneChangeOutput(stderr), [
    { timestampMs: 1250, score: null },
    { timestampMs: 4750, score: null },
  ]);
});

test("buildScenes creates deterministic contiguous boundaries", () => {
  assert.deepEqual(
    buildScenes(10_000, [
      { timestampMs: 2_000, score: 0.4 },
      { timestampMs: 7_000, score: 0.8 },
    ]),
    [
      { index: 0, startMs: 0, endMs: 2000, durationMs: 2000, confidence: 0.4 },
      {
        index: 1,
        startMs: 2000,
        endMs: 7000,
        durationMs: 5000,
        confidence: 0.8,
      },
      {
        index: 2,
        startMs: 7000,
        endMs: 10000,
        durationMs: 3000,
        confidence: null,
      },
    ],
  );
});

test("rankUsableSegments excludes tiny scenes and ranks stable candidates", () => {
  const scenes = buildScenes(10_000, [
    { timestampMs: 300, score: 0.9 },
    { timestampMs: 5_300, score: 0.7 },
  ]);
  const usable = rankUsableSegments(scenes, {
    minSceneMs: 700,
    maxSceneMs: 6_000,
  });

  assert.equal(usable.length, 2);
  assert.equal(usable[0]?.sceneIndex, 1);
  assert.ok((usable[0]?.score ?? 0) > (usable[1]?.score ?? 0));
});
