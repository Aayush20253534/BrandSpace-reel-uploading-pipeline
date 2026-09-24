import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReelProjectTransition,
  buildPublishingIdempotencyKey,
  canTransitionReelProject,
  normalizeClientSlug,
} from "./src/index.ts";

test("normalizes client slugs", () => {
  assert.equal(
    normalizeClientSlug("  Style Club Prayagraj  "),
    "style-club-prayagraj",
  );
});

test("allows valid reel workflow transitions", () => {
  assert.equal(canTransitionReelProject("DRAFT", "PLANNED"), true);
  assert.equal(canTransitionReelProject("QA", "AWAITING_APPROVAL"), true);
  assert.equal(canTransitionReelProject("PUBLISHING", "PUBLISHED"), true);
});

test("rejects invalid reel workflow transitions", () => {
  assert.equal(canTransitionReelProject("DRAFT", "PUBLISHED"), false);
  assert.throws(
    () => assertReelProjectTransition("PUBLISHED", "RENDERING"),
    /Invalid ReelProject transition/,
  );
});

test("publishing idempotency keys are stable for one publishing intent", () => {
  const scheduledAt = new Date("2026-09-25T12:00:00.000Z");
  assert.equal(
    buildPublishingIdempotencyKey("version-1", "instagram-1", scheduledAt),
    "version-1:instagram-1:2026-09-25T12:00:00.000Z",
  );
});
