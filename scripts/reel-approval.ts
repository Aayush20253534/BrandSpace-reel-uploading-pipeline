import { loadEnvFile } from "node:process";
import {
  Prisma,
  prisma,
  type MembershipRole,
} from "../packages/database/src/index.ts";
import {
  approvalActionResult,
  assertReelProjectTransition,
  type ApprovalAction,
} from "../packages/domain/src/index.ts";

loadEnvFile(".env");

const command = process.argv[2]?.trim();
const targetId = process.argv[3]?.trim();
const actorId = process.argv[4]?.trim();

const usage = () => {
  console.error(
    [
      "Usage:",
      "  npm run reel:approval -- request <reel-project-id> <actor-id>",
      "  npm run reel:approval -- decide <approval-id> <approve|revision|reject> <actor-id> [note]",
      "  npm run reel:approval -- reopen <reel-project-id> <actor-id>",
    ].join("\n"),
  );
};

function requireArgument(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function requireApprovalActor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
  allowed: readonly MembershipRole[],
) {
  const membership = await tx.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: actorId } },
    select: { role: true },
  });
  if (!membership || !allowed.includes(membership.role)) {
    throw new Error(
      "Actor does not have approval permission in this organization",
    );
  }
}

async function requestApproval(projectId: string, requestedById: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      const project = await tx.reelProject.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          state: true,
          activeVersion: true,
          client: {
            select: {
              id: true,
              approvalMode: true,
              organizationId: true,
            },
          },
        },
      });

      if (!project) throw new Error(`ReelProject not found: ${projectId}`);
      await requireApprovalActor(
        tx,
        project.client.organizationId,
        requestedById,
        ["OWNER", "ADMIN", "CONTENT_MANAGER", "EDITOR", "REVIEWER"],
      );
      if (project.client.approvalMode === "AUTO") {
        throw new Error(
          "AUTO approval projects do not create human approval requests",
        );
      }
      if (project.state !== "AWAITING_APPROVAL") {
        throw new Error(
          `ReelProject ${project.id} must be AWAITING_APPROVAL before requesting approval`,
        );
      }

      const activeVersion = await tx.reelVersion.findUnique({
        where: {
          reelProjectId_version: {
            reelProjectId: project.id,
            version: project.activeVersion,
          },
        },
        select: {
          id: true,
          qaReviews: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { decision: true, technical: true, creative: true },
          },
        },
      });
      if (!activeVersion) {
        throw new Error(
          `Active ReelVersion ${project.activeVersion} was not found`,
        );
      }

      const qa = activeVersion.qaReviews[0];
      if (
        !qa ||
        qa.decision !== "PASS" ||
        qa.technical === null ||
        qa.creative === null
      ) {
        throw new Error(
          `Active ReelVersion ${activeVersion.id} must pass technical and creative QA before approval`,
        );
      }

      const existing = await tx.approval.findFirst({
        where: {
          reelProjectId: project.id,
          reelVersionId: activeVersion.id,
          decision: "PENDING",
        },
        orderBy: { requestedAt: "desc" },
      });
      if (existing) return { approval: existing, reused: true };

      const approval = await tx.approval.create({
        data: {
          reelProjectId: project.id,
          reelVersionId: activeVersion.id,
          decision: "PENDING",
          requestedById,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: project.client.organizationId,
          clientId: project.client.id,
          actorType: "USER",
          actorId: requestedById,
          action: "reel.approval.requested",
          entityType: "Approval",
          entityId: approval.id,
          metadata: {
            reelProjectId: project.id,
            reelVersionId: activeVersion.id,
          },
        },
      });

      return { approval, reused: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  console.log(
    result.reused
      ? "[reel:approval] pending request already exists"
      : "[reel:approval] approval requested",
  );
  console.log(JSON.stringify(result.approval, null, 2));
}

async function decideApproval(
  approvalId: string,
  action: ApprovalAction,
  decidedById: string,
  note: string | undefined,
) {
  const mapping = approvalActionResult(action);

  const result = await prisma.$transaction(
    async (tx) => {
      const approval = await tx.approval.findUnique({
        where: { id: approvalId },
        select: {
          id: true,
          decision: true,
          reelProjectId: true,
          reelVersionId: true,
          reelVersion: { select: { version: true, reelProjectId: true } },
          reelProject: {
            select: {
              state: true,
              activeVersion: true,
              client: {
                select: { id: true, organizationId: true },
              },
            },
          },
        },
      });
      if (!approval) throw new Error(`Approval not found: ${approvalId}`);
      await requireApprovalActor(
        tx,
        approval.reelProject.client.organizationId,
        decidedById,
        ["OWNER", "ADMIN", "CONTENT_MANAGER", "REVIEWER"],
      );

      if (approval.decision !== "PENDING") {
        if (approval.decision === mapping.decision) {
          return {
            approvalId: approval.id,
            decision: approval.decision,
            projectState: approval.reelProject.state,
            reused: true,
          };
        }
        throw new Error(
          `Approval ${approval.id} is already ${approval.decision}; refusing conflicting decision`,
        );
      }

      if (approval.reelProject.state !== "AWAITING_APPROVAL") {
        throw new Error(
          `ReelProject ${approval.reelProjectId} must be AWAITING_APPROVAL before a decision`,
        );
      }
      if (
        !approval.reelVersionId ||
        !approval.reelVersion ||
        approval.reelVersion.reelProjectId !== approval.reelProjectId ||
        approval.reelVersion.version !== approval.reelProject.activeVersion
      ) {
        throw new Error(
          `Approval ${approval.id} does not bind the active reel version; request a new approval`,
        );
      }
      assertReelProjectTransition(
        approval.reelProject.state,
        mapping.projectState,
      );

      const claimed = await tx.approval.updateMany({
        where: {
          id: approval.id,
          reelVersionId: approval.reelVersionId,
          decision: "PENDING",
        },
        data: {
          decision: mapping.decision,
          decidedById,
          decidedAt: new Date(),
          note: note?.trim() || null,
        },
      });
      if (claimed.count !== 1) {
        throw new Error(
          `Approval ${approval.id} was decided concurrently; retry to read the durable result`,
        );
      }

      const moved = await tx.reelProject.updateMany({
        where: {
          id: approval.reelProjectId,
          state: "AWAITING_APPROVAL",
          activeVersion: approval.reelVersion.version,
        },
        data: { state: mapping.projectState },
      });
      if (moved.count !== 1) {
        throw new Error(
          `ReelProject ${approval.reelProjectId} changed concurrently`,
        );
      }

      await tx.auditEvent.create({
        data: {
          organizationId: approval.reelProject.client.organizationId,
          clientId: approval.reelProject.client.id,
          actorType: "USER",
          actorId: decidedById,
          action: `reel.approval.${action}`,
          entityType: "Approval",
          entityId: approval.id,
          metadata: {
            reelProjectId: approval.reelProjectId,
            reelVersionId: approval.reelVersionId,
            decision: mapping.decision,
          },
        },
      });

      return {
        approvalId: approval.id,
        decision: mapping.decision,
        projectState: mapping.projectState,
        reused: false,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  console.log(
    result.reused
      ? "[reel:approval] decision already recorded"
      : "[reel:approval] decision recorded",
  );
  console.log(JSON.stringify(result, null, 2));
}

async function reopenUnboundApproval(projectId: string, actorId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      const project = await tx.reelProject.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          state: true,
          activeVersion: true,
          client: {
            select: { id: true, organizationId: true, approvalMode: true },
          },
        },
      });
      if (!project || project.state !== "APPROVED") {
        throw new Error("Only an unscheduled APPROVED project can be reopened");
      }
      await requireApprovalActor(tx, project.client.organizationId, actorId, [
        "OWNER",
        "ADMIN",
      ]);
      if (project.client.approvalMode === "AUTO") {
        throw new Error("AUTO approval projects do not need a human decision");
      }
      const version = await tx.reelVersion.findUnique({
        where: {
          reelProjectId_version: {
            reelProjectId: project.id,
            version: project.activeVersion,
          },
        },
        select: { id: true, renderedAssetId: true },
      });
      if (!version?.renderedAssetId) {
        throw new Error("The active reel version needs a rendered artifact");
      }
      const jobs = await tx.publishingJob.count({
        where: { reelProjectId: project.id },
      });
      const approved = await tx.approval.findFirst({
        where: {
          reelProjectId: project.id,
          reelVersionId: version.id,
          decision: "APPROVED",
        },
        select: { id: true },
      });
      if (jobs !== 0 || approved) {
        throw new Error(
          "Project has publishing history or an active version approval; manual review required",
        );
      }
      const updated = await tx.reelProject.updateMany({
        where: {
          id: project.id,
          state: "APPROVED",
          activeVersion: project.activeVersion,
        },
        data: { state: "AWAITING_APPROVAL" },
      });
      if (updated.count !== 1) {
        throw new Error("Project changed concurrently; retry after inspection");
      }
      await tx.auditEvent.create({
        data: {
          organizationId: project.client.organizationId,
          clientId: project.client.id,
          actorType: "USER",
          actorId,
          action: "reel.approval.reopened_for_version",
          entityType: "ReelProject",
          entityId: project.id,
          metadata: { reelVersionId: version.id },
        },
      });
      return { reelProjectId: project.id, reelVersionId: version.id };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
  console.log("[reel:approval] project reopened for a version-bound review");
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  if (command === "request") {
    await requestApproval(
      requireArgument(targetId, "reel-project-id"),
      requireArgument(actorId, "actor-id"),
    );
    return;
  }

  if (command === "decide") {
    const approvalId = requireArgument(targetId, "approval-id");
    const action = requireArgument(actorId, "decision") as ApprovalAction;
    if (!["approve", "revision", "reject"].includes(action)) {
      throw new Error("decision must be approve, revision, or reject");
    }
    const decidedById = requireArgument(process.argv[5]?.trim(), "actor-id");
    const note = process.argv.slice(6).join(" ").trim() || undefined;
    await decideApproval(approvalId, action, decidedById, note);
    return;
  }

  if (command === "reopen") {
    await reopenUnboundApproval(
      requireArgument(targetId, "reel-project-id"),
      requireArgument(actorId, "actor-id"),
    );
    return;
  }

  usage();
  throw new Error("command must be request, decide, or reopen");
}

main()
  .catch((error: unknown) => {
    console.error("[reel:approval] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
