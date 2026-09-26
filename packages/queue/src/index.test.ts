import assert from "node:assert/strict";
import test from "node:test";
import {
  delayUntil,
  isFinalPublishingAttempt,
  isSafeToReconcilePublishingJob,
  publishingQueueJobId,
} from "./index";

test("publishing queue job ids are stable", () => {
  assert.equal(
    publishingQueueJobId("publishing-job-1"),
    "publishing-publishing-job-1",
  );
});

test("manual reconciliation never replays an ambiguous or exhausted publish", () => {
  const scheduled = {
    state: "SCHEDULED",
    attemptCount: 0,
    externalContainerId: null,
    externalMediaId: null,
  };
  assert.equal(isSafeToReconcilePublishingJob(scheduled), true);
  assert.equal(
    isSafeToReconcilePublishingJob({ ...scheduled, state: "RETRY_WAIT" }),
    true,
  );
  for (const unsafe of [
    { ...scheduled, state: "NEEDS_ATTENTION" },
    { ...scheduled, state: "DISPATCHED" },
    { ...scheduled, attemptCount: 5 },
    { ...scheduled, externalContainerId: "container-1" },
    { ...scheduled, externalMediaId: "media-1" },
  ]) {
    assert.equal(isSafeToReconcilePublishingJob(unsafe), false);
  }
});

test("delayUntil schedules future work and clamps past work to zero", () => {
  const now = new Date("2026-09-25T15:00:00.000Z");
  assert.equal(delayUntil(new Date("2026-09-25T15:05:00.000Z"), now), 300_000);
  assert.equal(delayUntil(new Date("2026-09-25T14:59:00.000Z"), now), 0);
});

test("final-attempt detection respects the configured attempt budget", () => {
  assert.equal(isFinalPublishingAttempt(0, 5), false);
  assert.equal(isFinalPublishingAttempt(4, 5), false);
  assert.equal(isFinalPublishingAttempt(5, 5), true);
  assert.equal(isFinalPublishingAttempt(6, 5), true);
  assert.equal(isFinalPublishingAttempt(1, 0), true);
});
