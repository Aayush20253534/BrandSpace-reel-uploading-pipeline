"use server";

import { revalidatePath } from "next/cache";
import { env } from "@forge/config";
import { prisma } from "@forge/database";
import {
  createPublishingQueueClient,
  isSafeToReconcilePublishingJob,
} from "@forge/queue";
import { requireRole } from "../../lib/auth-session";

const OPERATOR_ROLES = ["OWNER", "ADMIN", "CONTENT_MANAGER"] as const;

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
