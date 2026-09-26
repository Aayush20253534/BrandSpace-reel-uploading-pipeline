import { Prisma, type PrismaClient } from "@forge/database";
import {
  approvalActionResult,
  type ApprovalAction,
} from "./approval-policy.js";

export class ApprovalDecisionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ApprovalDecisionError";
  }
}

export async function decideReelApproval(input: {
  database: PrismaClient;
  approvalId: string;
  action: ApprovalAction;
  actorId: string;
  note?: string;
  expectedOrganizationId?: string;
  expectedClientId?: string;
}) {
  const mapping = approvalActionResult(input.action);
  if (input.note && input.note.length > 2_000) {
    throw new ApprovalDecisionError("NOTE_TOO_LONG");
  }

  return input.database.$transaction(
    async (tx) => {
      const approval = await tx.approval.findUnique({
        where: { id: input.approvalId },
        select: {
          id: true,
          decision: true,
          reelProjectId: true,
          reelVersionId: true,
          reelVersion: {
            select: {
              version: true,
              reelProjectId: true,
              renderedAssetId: true,
            },
          },
          reelProject: {
            select: {
              state: true,
              activeVersion: true,
              client: { select: { id: true, organizationId: true } },
            },
          },
        },
      });
      if (!approval) throw new ApprovalDecisionError("APPROVAL_NOT_FOUND");
      const client = approval.reelProject.client;
      if (
        (input.expectedOrganizationId &&
          client.organizationId !== input.expectedOrganizationId) ||
        (input.expectedClientId && client.id !== input.expectedClientId)
      ) {
        throw new ApprovalDecisionError("APPROVAL_NOT_FOUND");
      }
      const membership = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: client.organizationId,
            userId: input.actorId,
          },
        },
        select: { role: true },
      });
      if (
        !membership ||
        !["OWNER", "ADMIN", "CONTENT_MANAGER", "REVIEWER"].includes(
          membership.role,
        )
      ) {
        throw new ApprovalDecisionError("FORBIDDEN");
      }

      if (approval.decision !== "PENDING") {
        if (approval.decision === mapping.decision) {
          return {
            approvalId: approval.id,
            decision: approval.decision,
            projectState: approval.reelProject.state,
            reused: true,
          };
        }
        throw new ApprovalDecisionError("APPROVAL_ALREADY_DECIDED");
      }
      if (approval.reelProject.state !== "AWAITING_APPROVAL") {
        throw new ApprovalDecisionError("PROJECT_NOT_AWAITING_APPROVAL");
      }
      if (
        !approval.reelVersionId ||
        !approval.reelVersion ||
        approval.reelVersion.reelProjectId !== approval.reelProjectId ||
        approval.reelVersion.version !== approval.reelProject.activeVersion
      ) {
        throw new ApprovalDecisionError("APPROVAL_VERSION_STALE");
      }
      if (!approval.reelVersion.renderedAssetId) {
        throw new ApprovalDecisionError("ARTIFACT_UNAVAILABLE");
      }
      const artifact = await tx.mediaAsset.findFirst({
        where: {
          id: approval.reelVersion.renderedAssetId,
          clientId: client.id,
          kind: "GENERATED_REEL",
          state: "READY",
        },
        select: { id: true },
      });
      if (!artifact) throw new ApprovalDecisionError("ARTIFACT_UNAVAILABLE");

      const claimed = await tx.approval.updateMany({
        where: {
          id: approval.id,
          reelVersionId: approval.reelVersionId,
          decision: "PENDING",
        },
        data: {
          decision: mapping.decision,
          decidedById: input.actorId,
          decidedAt: new Date(),
          note: input.note?.trim() || null,
        },
      });
      if (claimed.count !== 1) {
        throw new ApprovalDecisionError("APPROVAL_CONCURRENT_CHANGE");
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
        throw new ApprovalDecisionError("PROJECT_CONCURRENT_CHANGE");
      }
      await tx.auditEvent.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorType: "USER",
          actorId: input.actorId,
          action: `reel.approval.${input.action}`,
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
}
