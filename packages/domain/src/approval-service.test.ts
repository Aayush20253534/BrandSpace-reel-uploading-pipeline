import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@forge/database";
import {
  ApprovalDecisionError,
  decideReelApproval,
} from "./approval-service.js";

function fixture(
  options: {
    activeVersion?: number;
    role?: string;
    artifactReady?: boolean;
  } = {},
) {
  const writes: string[] = [];
  const tx = {
    approval: {
      findUnique: async () => ({
        id: "approval-1",
        decision: "PENDING",
        reelProjectId: "project-1",
        reelVersionId: "version-2",
        reelVersion: {
          version: 2,
          reelProjectId: "project-1",
          renderedAssetId: "asset-2",
        },
        reelProject: {
          state: "AWAITING_APPROVAL",
          activeVersion: options.activeVersion ?? 2,
          client: { id: "client-1", organizationId: "org-1" },
        },
      }),
      updateMany: async () => {
        writes.push("approval");
        return { count: 1 };
      },
    },
    membership: {
      findUnique: async () => ({ role: options.role ?? "REVIEWER" }),
    },
    mediaAsset: {
      findFirst: async () =>
        options.artifactReady === false ? null : { id: "asset-2" },
    },
    reelProject: {
      updateMany: async () => {
        writes.push("project");
        return { count: 1 };
      },
    },
    auditEvent: {
      create: async () => {
        writes.push("audit");
        return { id: "audit-1" };
      },
    },
  };
  const database = {
    $transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
      run(tx),
  } as unknown as PrismaClient;
  return { database, writes };
}

test("decision updates approval, project and audit in one transaction", async () => {
  const { database, writes } = fixture();
  const result = await decideReelApproval({
    database,
    approvalId: "approval-1",
    action: "approve",
    actorId: "reviewer-1",
    expectedOrganizationId: "org-1",
    expectedClientId: "client-1",
  });
  assert.equal(result.decision, "APPROVED");
  assert.deepEqual(writes, ["approval", "project", "audit"]);
});

test("stale version and unauthorized actor cannot decide", async () => {
  for (const options of [
    { activeVersion: 3, role: "REVIEWER" },
    { activeVersion: 2, role: "VIEWER" },
    { activeVersion: 2, role: "REVIEWER", artifactReady: false },
  ]) {
    const { database, writes } = fixture(options);
    await assert.rejects(
      decideReelApproval({
        database,
        approvalId: "approval-1",
        action: "approve",
        actorId: "actor-1",
        expectedOrganizationId: "org-1",
        expectedClientId: "client-1",
      }),
      (error: unknown) => error instanceof ApprovalDecisionError,
    );
    assert.deepEqual(writes, []);
  }
});
