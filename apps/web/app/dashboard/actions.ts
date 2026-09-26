"use server";

import { revalidatePath } from "next/cache";
import { env } from "@forge/config";
import { prisma } from "@forge/database";
import {
  ApprovalDecisionError,
  decideReelApproval,
} from "@forge/domain/approval";
import type { ApprovalAction } from "@forge/domain";
import {
  createPublishingQueueClient,
  isSafeToReconcilePublishingJob,
} from "@forge/queue";
import { requireRole } from "../../lib/auth-session";

const OPERATOR_ROLES = ["OWNER", "ADMIN", "CONTENT_MANAGER"] as const;
const REVIEW_ROLES = ["OWNER", "ADMIN", "CONTENT_MANAGER", "REVIEWER"] as const;

export interface DecisionActionState {
  ok: boolean | null;
  message: string;
}

export async function recordApprovalDecision(
  _previous: DecisionActionState,
  formData: FormData,
): Promise<DecisionActionState> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const approvalId = String(formData.get("approvalId") ?? "");
  const rawAction = String(formData.get("action") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (
    !organizationId ||
    !clientId ||
    !approvalId ||
    !["approve", "revision", "reject"].includes(rawAction) ||
    note.length > 2_000
  ) {
    return { ok: false, message: "Check the decision and note, then retry." };
  }
  try {
    const { session } = await requireRole(organizationId, REVIEW_ROLES);
    const result = await decideReelApproval({
      database: prisma,
      approvalId,
      action: rawAction as ApprovalAction,
      actorId: session.user.id,
      expectedOrganizationId: organizationId,
      expectedClientId: clientId,
      ...(note ? { note } : {}),
    });
    revalidatePath("/dashboard/approvals");
    revalidatePath("/dashboard/audit");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: result.reused
        ? "Decision was already recorded."
        : "Decision recorded.",
    };
  } catch (error) {
    if (error instanceof ApprovalDecisionError) {
      if (error.code === "APPROVAL_VERSION_STALE") {
        return {
          ok: false,
          message: "This review is for an older reel version.",
        };
      }
      if (error.code === "APPROVAL_ALREADY_DECIDED") {
        return { ok: false, message: "This review already has a decision." };
      }
      if (error.code === "PROJECT_NOT_AWAITING_APPROVAL") {
        return {
          ok: false,
          message: "This reel is no longer awaiting approval.",
        };
      }
      if (error.code === "ARTIFACT_UNAVAILABLE") {
        return {
          ok: false,
          message: "The rendered reel is unavailable for review.",
        };
      }
    }
    return {
      ok: false,
      message: "Unable to record this decision. Refresh and retry.",
    };
  }
}

export async function reconcilePublishingJob(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const publishingJobId = String(formData.get("publishingJobId") ?? "");
  if (!organizationId || !clientId || !publishingJobId) {
    throw new Error("INVALID_REQUEST");
  }
  const { session } = await requireRole(organizationId, OPERATOR_ROLES);
  const job = await prisma.publishingJob.findFirst({
    where: {
      id: publishingJobId,
      reelProject: { clientId, client: { organizationId } },
    },
    select: {
      id: true,
      reelProjectId: true,
      reelVersionId: true,
      socialAccountId: true,
      idempotencyKey: true,
      state: true,
      attemptCount: true,
      scheduledAt: true,
      externalContainerId: true,
      externalMediaId: true,
    },
  });
  if (!job) throw new Error("JOB_NOT_FOUND");
  if (!isSafeToReconcilePublishingJob(job)) {
    throw new Error("JOB_NOT_RECONCILABLE");
  }
  if (!env.REDIS_URL) throw new Error("QUEUE_UNAVAILABLE");

  const queue = createPublishingQueueClient(env.REDIS_URL);
  try {
    const result = await queue.reconcile(
      {
        publishingJobId: job.id,
        reelProjectId: job.reelProjectId,
        reelVersionId: job.reelVersionId,
        socialAccountId: job.socialAccountId,
        idempotencyKey: job.idempotencyKey,
      },
      job.scheduledAt,
      { repairFailed: true },
    );
    await prisma.auditEvent.create({
      data: {
        organizationId,
        clientId,
        actorType: "USER",
        actorId: session.user.id,
        action: "publishing.queue_reconciled",
        entityType: "PublishingJob",
        entityId: job.id,
        metadata: { queueAction: result.action, queueState: result.queueState },
      },
    });
  } finally {
    await queue.close();
  }
  revalidatePath("/dashboard/publishing");
  revalidatePath("/dashboard/audit");
}
