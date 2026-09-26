import assert from "node:assert/strict";
import test from "node:test";
import {
  publishingPreflightError,
  type PublishingPreflight,
} from "./publishing-preflight.js";

const base: PublishingPreflight = {
  jobState: "SCHEDULED",
  jobProjectId: "project-1",
  jobVersionId: "version-2",
  jobAccountId: "account-1",
  project: {
    id: "project-1",
    state: "SCHEDULED",
    activeVersion: 2,
    clientId: "client-1",
    approvalMode: "REQUIRED",
  },
  version: {
    id: "version-2",
    reelProjectId: "project-1",
    version: 2,
    renderedAssetId: "asset-2",
  },
  account: {
    id: "account-1",
    clientId: "client-1",
    status: "CONNECTED",
    hasCredential: true,
    tokenExpiresAt: new Date("2030-01-01T00:00:00Z"),
  },
  hasVersionApproval: true,
};

test("publishing requires approval for the exact active version", () => {
  const now = new Date("2026-09-26T00:00:00Z");
  assert.equal(publishingPreflightError(base, now), null);
  assert.equal(
    publishingPreflightError({ ...base, hasVersionApproval: false }, now),
    "VERSION_APPROVAL_MISSING",
  );
  assert.equal(
    publishingPreflightError(
      { ...base, project: { ...base.project, activeVersion: 3 } },
      now,
    ),
    "ACTIVE_VERSION_CHANGED",
  );
  assert.equal(
    publishingPreflightError(
      {
        ...base,
        project: { ...base.project, approvalMode: "AUTO" },
        hasVersionApproval: false,
      },
      now,
    ),
    null,
  );
});

test("publishing blocks cross-client and expired accounts", () => {
  const now = new Date("2026-09-26T00:00:00Z");
  assert.equal(
    publishingPreflightError(
      { ...base, account: { ...base.account, clientId: "client-2" } },
      now,
    ),
    "SOCIAL_ACCOUNT_SCOPE_CHANGED",
  );
  assert.equal(
    publishingPreflightError(
      { ...base, account: { ...base.account, tokenExpiresAt: now } },
      now,
    ),
    "SOCIAL_ACCOUNT_NOT_READY",
  );
});
