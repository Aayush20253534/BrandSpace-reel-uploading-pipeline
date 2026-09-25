import assert from "node:assert/strict";
import { test } from "node:test";
import { probeMedia, representativeFrameTimestamps } from "./index";

test("probeMedia is exposed for deterministic ffprobe probing", () => {
  assert.equal(typeof probeMedia, "function");
});

test("representativeFrameTimestamps uses stable quartile-like positions", () => {
  assert.deepEqual(
    representativeFrameTimestamps(35_633, 4),
    [3563, 12472, 21380, 30288],
  );
});

test("representativeFrameTimestamps stays bounded for short media", () => {
  assert.deepEqual(representativeFrameTimestamps(500, 4), [250]);
  assert.deepEqual(representativeFrameTimestamps(10_000, 1), [5000]);
});
