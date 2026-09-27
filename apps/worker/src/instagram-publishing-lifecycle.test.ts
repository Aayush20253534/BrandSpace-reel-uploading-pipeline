import assert from "node:assert/strict";
import test from "node:test";
import {
  nextContainerAction,
  nextPublishingAction,
} from "./instagram-publishing-lifecycle.js";

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
