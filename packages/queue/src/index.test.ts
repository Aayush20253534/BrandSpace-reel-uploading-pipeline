import assert from "node:assert/strict";
import test from "node:test";
import { delayUntil, publishingQueueJobId } from "./index";

test("publishing queue job ids are stable", () => {
  assert.equal(
    publishingQueueJobId("publishing-job-1"),
    "publishing-publishing-job-1",
  );
});

test("delayUntil schedules future work and clamps past work to zero", () => {
  const now = new Date("2026-09-25T15:00:00.000Z");
  assert.equal(delayUntil(new Date("2026-09-25T15:05:00.000Z"), now), 300_000);
  assert.equal(delayUntil(new Date("2026-09-25T14:59:00.000Z"), now), 0);
});
