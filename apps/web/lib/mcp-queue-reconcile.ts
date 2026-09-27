import { createHash } from "node:crypto";
import { env } from "@forge/config";
import { Prisma, prisma } from "@forge/database";
import {
  createPublishingQueueClient,
  isSafeToReconcilePublishingJob,
} from "@forge/queue";
import type { AgentContext } from "./mcp-auth";
import { AgentMutationError } from "./mcp-mutations";

interface ReconcileInput {
  clientId: string;
  publishingJobId: string;
  idempotencyKey: string;
}

const TOOL_NAME = "reconcile_publishing_queue_job";
const ROLES = ["OWNER", "ADMIN", "CONTENT_MANAGER"];

function verifyStoredResult(
  value: Prisma.JsonValue,
  hash: string,
  storedHash: string,
  jobId: string,
) {
  if (hash !== storedHash)
    throw new AgentMutationError("IDEMPOTENCY_KEY_REUSED");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.publishingJobId !== jobId
  ) {
    throw new AgentMutationError("IDEMPOTENCY_RESULT_INVALID");
  }
}

export async function reconcileAgentPublishingQueueJob(
  context: AgentContext,
  input: ReconcileInput,
) {
  if (
    context.clientId !== input.clientId ||
    !context.scopes.includes("write") ||
    !ROLES.includes(context.role)
  )
    throw new AgentMutationError("FORBIDDEN");
  if (!env.REDIS_URL) throw new AgentMutationError("QUEUE_UNAVAILABLE");

  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        clientId: input.clientId,
        publishingJobId: input.publishingJobId,
      }),
    )
    .digest("hex");
  const key = {
    credentialId_toolName_idempotencyKey: {
      credentialId: context.credentialId,
      toolName: TOOL_NAME,
      idempotencyKey: input.idempotencyKey,
    },
  };
  let reused = false;
  try {
    reused = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const [credential, membership, job] = await Promise.all([
          tx.agentAccessToken.findFirst({
            where: {
              id: context.credentialId,
              userId: context.userId,
              organizationId: context.organizationId,
              clientId: input.clientId,
              scopes: { has: "write" },
              revokedAt: null,
              expiresAt: { gt: now },
            },
            select: { id: true },
          }),
          tx.membership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: context.organizationId,
                userId: context.userId,
              },
            },
            select: { role: true },
          }),
          tx.publishingJob.findFirst({
            where: {
              id: input.publishingJobId,
              reelProject: {
                clientId: input.clientId,
                client: {
                  organizationId: context.organizationId,
                  status: "ACTIVE",
                },
              },
            },
            select: {
              state: true,
              attemptCount: true,
              externalContainerId: true,
              externalMediaId: true,
              containerCreateIntentAt: true,
              publishIntentAt: true,
              scheduledAt: true,
            },
          }),
        ]);
        if (!credential || !membership || !ROLES.includes(membership.role))
          throw new AgentMutationError("FORBIDDEN");
        if (!job) throw new AgentMutationError("JOB_UNAVAILABLE");
        const prior = await tx.agentMutation.findUnique({
          where: key,
          select: { requestHash: true, result: true },
        });
        if (prior) {
          verifyStoredResult(
            prior.result,
            requestHash,
            prior.requestHash,
            input.publishingJobId,
          );
          return true;
        }
        if (!isSafeToReconcilePublishingJob(job))
          throw new AgentMutationError("JOB_NOT_RECONCILABLE");
        if (job.scheduledAt.getTime() < now.getTime() - 15 * 60_000)
          throw new AgentMutationError("SCHEDULE_START_WINDOW_EXPIRED");
        await tx.agentMutation.create({
          data: {
            credentialId: context.credentialId,
            toolName: TOOL_NAME,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            result: { publishingJobId: input.publishingJobId },
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            clientId: input.clientId,
            actorType: "USER",
            actorId: context.userId,
            action: "publishing.queue_reconcile_requested",
            entityType: "PublishingJob",
            entityId: input.publishingJobId,
            metadata: {
              source: "mcp",
              credentialId: context.credentialId,
            },
          },
        });
        return false;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await prisma.agentMutation.findUnique({
        where: key,
        select: { requestHash: true, result: true },
      });
      if (!winner) throw error;
      verifyStoredResult(
        winner.result,
        requestHash,
        winner.requestHash,
        input.publishingJobId,
      );
      reused = true;
    } else {
      throw error;
    }
  }

  const job = await prisma.publishingJob.findFirst({
    where: {
      id: input.publishingJobId,
      reelProject: {
        clientId: input.clientId,
        client: { organizationId: context.organizationId },
      },
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
      containerCreateIntentAt: true,
      publishIntentAt: true,
    },
  });
  if (!job) throw new AgentMutationError("JOB_UNAVAILABLE");
  if (!isSafeToReconcilePublishingJob(job)) {
    return {
      publishingJobId: job.id,
      state: job.state,
      queueAction: "not_pending",
      reused,
    };
  }
  if (job.scheduledAt.getTime() < Date.now() - 15 * 60_000)
    throw new AgentMutationError("SCHEDULE_START_WINDOW_EXPIRED");
  const queue = createPublishingQueueClient(env.REDIS_URL);
  try {
    const outcome = await queue.reconcile(
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
    return {
      publishingJobId: job.id,
      state: job.state,
      queueAction: outcome.action,
      queueState: outcome.queueState,
      reused,
    };
  } catch {
    throw new AgentMutationError("QUEUE_UNAVAILABLE");
  } finally {
    await queue.close().catch(() => undefined);
  }
}
