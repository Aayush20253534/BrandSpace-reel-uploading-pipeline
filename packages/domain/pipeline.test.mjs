import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalActionResult,
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

test("maps human approval actions to durable decisions and project states", () => {
  assert.deepEqual(approvalActionResult("approve"), {
    decision: "APPROVED",
    projectState: "APPROVED",
  });
  assert.deepEqual(approvalActionResult("revision"), {
    decision: "REVISION_REQUESTED",
    projectState: "REVISION_REQUESTED",
  });
  assert.deepEqual(approvalActionResult("reject"), {
    decision: "REJECTED",
    projectState: "REJECTED",
  });
});
