import assert from "node:assert/strict";
import test from "node:test";
import {
  isEarlyUnstartedPublication,
  isStaleUnstartedPublication,
  nextContainerAction,
  nextPublishingAction,
} from "./instagram-publishing-lifecycle.js";

test("old unstarted schedules cannot begin a remote publish after the live switch is enabled", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  const base = {
    state: "DISPATCHED",
    scheduledAt: new Date("2026-09-27T11:44:59.000Z"),
    externalContainerId: null,
    containerCreateIntentAt: null,
  };
  assert.equal(isStaleUnstartedPublication(base, now), true);
  assert.equal(
    isStaleUnstartedPublication(
      { ...base, scheduledAt: new Date("2026-09-27T11:45:00.000Z") },
      now,
    ),
    false,
  );
  assert.equal(
    isStaleUnstartedPublication(
      { ...base, externalContainerId: "existing-container" },
      now,
    ),
    false,
  );
  assert.equal(
    isEarlyUnstartedPublication(
      { ...base, scheduledAt: new Date("2026-09-27T12:01:00.000Z") },
      now,
    ),
    true,
  );
});

test("replayed jobs never repeat an uncertain remote write", () => {
  const now = new Date();
  assert.equal(
    nextPublishingAction({
      externalContainerId: null,
      externalMediaId: null,
      containerCreateIntentAt: null,
      publishIntentAt: null,
    }),
    "CREATE_CONTAINER",
  );
  assert.equal(
    nextPublishingAction({
      externalContainerId: null,
      externalMediaId: null,
      containerCreateIntentAt: now,
      publishIntentAt: null,
    }),
    "QUARANTINE_CREATE",
  );
  assert.equal(
    nextPublishingAction({
      externalContainerId: "200",
      externalMediaId: null,
      containerCreateIntentAt: now,
      publishIntentAt: null,
    }),
    "POLL_CONTAINER",
  );
  assert.equal(
    nextPublishingAction({
      externalContainerId: "200",
      externalMediaId: null,
      containerCreateIntentAt: now,
      publishIntentAt: now,
    }),
    "QUARANTINE_PUBLISH",
  );
  assert.equal(
    nextPublishingAction({
      externalContainerId: "200",
      externalMediaId: "300",
      containerCreateIntentAt: now,
      publishIntentAt: now,
    }),
    "VERIFY_MEDIA",
  );
});

test("container status permits publish only after FINISHED", () => {
  assert.equal(
    nextContainerAction({ status: "IN_PROGRESS", pollCount: 1 }),
    "WAIT",
  );
  assert.equal(
    nextContainerAction({ status: "FINISHED", pollCount: 60 }),
    "PUBLISH",
  );
  assert.equal(
    nextContainerAction({ status: "ERROR", pollCount: 1 }),
    "ATTENTION",
  );
  assert.equal(
    nextContainerAction({ status: "EXPIRED", pollCount: 1 }),
    "ATTENTION",
  );
  assert.equal(
    nextContainerAction({ status: "IN_PROGRESS", pollCount: 60 }),
    "ATTENTION",
  );
  assert.equal(
    nextContainerAction({ status: "UNKNOWN", pollCount: 1 }),
    "ATTENTION",
  );
});
