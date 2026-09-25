import { loadEnvFile } from "node:process";
import { Prisma, prisma } from "../packages/database/src/index.ts";
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
    ].join("\n"),
  );
};

function requireArgument(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
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
        where: { reelProjectId: project.id, decision: "PENDING" },
        orderBy: { requestedAt: "desc" },
      });
      if (existing) return { approval: existing, reused: true };

      const approval = await tx.approval.create({
        data: {
          reelProjectId: project.id,
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
          reelProject: {
            select: {
              state: true,
              client: {
                select: { id: true, organizationId: true },
              },
            },
          },
        },
      });
      if (!approval) throw new Error(`Approval not found: ${approvalId}`);

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
      assertReelProjectTransition(
        approval.reelProject.state,
        mapping.projectState,
      );

      const claimed = await tx.approval.updateMany({
        where: { id: approval.id, decision: "PENDING" },
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

  usage();
  throw new Error("command must be request or decide");
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
