import assert from "node:assert/strict";
import test from "node:test";
import { extractReelFeatures } from "./feedback";

test("feedback features are deterministic and reference exact source assets", () => {
  const input = {
    blueprint: {
      targetDurationMs: 25_000,
      objective: "Original brief",
      hook: "Ready to try this?",
      caption: "A short caption",
      cta: "Save this",
    },
    sources: [
      {
        mediaAssetId: "asset-b",
        order: 2,
        role: "CTA",
        inMs: 2_000,
        outMs: 5_000,
      },
      {
        mediaAssetId: "asset-a",
        order: 1,
        role: "HOOK",
        inMs: 0,
        outMs: 2_000,
      },
    ],
    objective: "Awareness",
    campaignKey: "launch",
    timezone: "Asia/Kolkata",
    publishingJob: {
      state: "PUBLISHED",
      scheduledAt: new Date("2026-09-26T03:00:00.000Z"),
      publishedAt: new Date("2026-09-26T04:00:00.000Z"),
    },
  };
  const first = extractReelFeatures(input);
  assert.deepEqual(first, extractReelFeatures(input));
  assert.equal(first.durationBand, "15_TO_30S");
  assert.equal(first.hookSurfaceForm, "QUESTION_PUNCTUATION");
  assert.deepEqual(first.sourceAssetIds, ["asset-a", "asset-b"]);
  assert.deepEqual(first.sectionRoles, ["HOOK", "CTA"]);
  assert.equal(first.averageClipMs, 2_500);
  assert.equal(first.postingHourLocal, 9);
  assert.equal(first.contentPillar, "UNLABELED");
  assert.equal(first.subtitleUsage, "UNRECORDED");
  assert.equal(first.objective, "Original brief");
  assert.equal(first.objectiveProvenance, "IMMUTABLE_BLUEPRINT");
  assert.equal(first.campaignKeyAtSync, "launch");
  assert.equal(first.ctaCategory, "SAVE");
});

test("feedback leaves unavailable fields unknown", () => {
  const result = extractReelFeatures({
    blueprint: {},
    sources: [],
    objective: null,
    campaignKey: null,
    timezone: "Invalid/Timezone",
  });
  assert.equal(result.durationBand, "UNKNOWN");
  assert.equal(result.averageClipMs, null);
  assert.equal(result.clipsPerMinute, null);
  assert.equal(result.postingHourLocal, null);
  assert.equal(result.publishingStateAtSync, null);
  assert.equal(result.ctaCategory, "ABSENT");
});
