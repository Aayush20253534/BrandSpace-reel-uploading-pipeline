import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { createLogger } from "@forge/logger";
import {
  createPublishingQueueClient,
  createPublishingWorker,
  isFinalPublishingAttempt,
  PUBLISHING_MAX_ATTEMPTS,
  type PublishingDispatchContext,
  type PublishingDispatchJob,
} from "@forge/queue";
import { APP_NAME, PHASE } from "@forge/shared";
import { startInstagramTokenLifecycle } from "./instagram-token-lifecycle.js";
import { startInstagramInsightsCollector } from "./instagram-insights.js";
import { startInstagramPublishingLifecycle } from "./instagram-publishing-lifecycle.js";
import {
  cleanupPublicationMedia,
  createCanonicalStorage,
  createTemporaryDelivery,
} from "./publication-media.js";
import { publishingPreflightError } from "./publishing-preflight.js";

const logger = createLogger("worker");

const RECONCILE_INTERVAL_MS = 60_000;
const RECONCILE_LOOKAHEAD_MS = 24 * 60 * 60 * 1_000;
const RECONCILE_BATCH_SIZE = 250;

logger.info("worker_started", {
  app: APP_NAME,
  phase: PHASE,
  environment: env.NODE_ENV,
});

const instagramTokenLifecycle = startInstagramTokenLifecycle();
const instagramInsightsCollector = startInstagramInsightsCollector();

const publicationDeliveryConfigured = Boolean(
  env.PUBLICATION_S3_ENDPOINT &&
  env.PUBLICATION_S3_REGION &&
  env.PUBLICATION_S3_BUCKET &&
  env.PUBLICATION_S3_ACCESS_KEY_ID &&
  env.PUBLICATION_S3_SECRET_ACCESS_KEY,
);
const temporaryDelivery = publicationDeliveryConfigured
  ? createTemporaryDelivery()
  : null;
if (env.INSTAGRAM_LIVE_PUBLISH_ENABLED && !temporaryDelivery) {
  throw new Error(
    "Live Instagram publishing requires temporary media delivery",
  );
}
const publishingLifecycle =
  env.INSTAGRAM_LIVE_PUBLISH_ENABLED && temporaryDelivery
    ? startInstagramPublishingLifecycle(
        createCanonicalStorage(),
        temporaryDelivery,
      )
    : null;
let mediaCleanupTimer: NodeJS.Timeout | null = null;
if (temporaryDelivery) {
  const cleanup = () =>
    void cleanupPublicationMedia(temporaryDelivery).catch((error) => {
      logger.error("publication_media_cleanup_failed", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
    });
  cleanup();
  mediaCleanupTimer = setInterval(cleanup, 30 * 60 * 1_000);
  mediaCleanupTimer.unref();
}

let publishingWorker: ReturnType<typeof createPublishingWorker> | null = null;
let publishingQueueClient: ReturnType<
  typeof createPublishingQueueClient
> | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;

async function markQueueStateMismatch(
  publishingJobId: string,
  queueState: string,
) {
  const updated = await prisma.publishingJob.updateMany({
    where: {
      id: publishingJobId,
      state: {
        in: ["SCHEDULED", "RETRY_WAIT"],
      },
      attemptCount: { lt: PUBLISHING_MAX_ATTEMPTS },
    },
    data: {
      state: "NEEDS_ATTENTION",
      lockedAt: null,
      lastErrorCode:
        queueState === "failed"
          ? "QUEUE_DISPATCH_EXHAUSTED"
          : "QUEUE_DB_STATE_MISMATCH",
      lastErrorMessage: `BullMQ job is ${queueState} while PostgreSQL is still pending`,
    },
  });

  if (updated.count > 0) {
    logger.error("publishing_queue_state_mismatch", {
      publishingJobId,
      queueState,
    });
  }
}

async function reconcilePublishingQueue() {
  if (!publishingQueueClient) return;

  const exhausted = await prisma.publishingJob.updateMany({
    where: {
      state: { in: ["SCHEDULED", "RETRY_WAIT"] },
      attemptCount: { gte: PUBLISHING_MAX_ATTEMPTS },
      externalContainerId: null,
      externalMediaId: null,
      containerCreateIntentAt: null,
      publishIntentAt: null,
    },
    data: {
      state: "NEEDS_ATTENTION",
      lockedAt: null,
      lastErrorCode: "QUEUE_DISPATCH_EXHAUSTED",
      lastErrorMessage: "Dispatch attempt budget exhausted",
    },
  });
  if (exhausted.count > 0)
    logger.warn("publishing_dispatch_budget_exhausted", {
      count: exhausted.count,
    });

  const jobs = await prisma.publishingJob.findMany({
    where: {
      state: {
        in: ["SCHEDULED", "RETRY_WAIT"],
      },
      attemptCount: { lt: PUBLISHING_MAX_ATTEMPTS },
      externalContainerId: null,
      externalMediaId: null,
      containerCreateIntentAt: null,
      publishIntentAt: null,
      scheduledAt: {
        lte: new Date(Date.now() + RECONCILE_LOOKAHEAD_MS),
      },
    },
    select: {
      id: true,
      reelProjectId: true,
      reelVersionId: true,
      socialAccountId: true,
      idempotencyKey: true,
      scheduledAt: true,
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: RECONCILE_BATCH_SIZE,
  });

  let enqueued = 0;
  let repaired = 0;
  let present = 0;

  for (const job of jobs) {
    const result = await publishingQueueClient.reconcile(
      {
        publishingJobId: job.id,
        reelProjectId: job.reelProjectId,
        reelVersionId: job.reelVersionId,
        socialAccountId: job.socialAccountId,
        idempotencyKey: job.idempotencyKey,
      },
      job.scheduledAt,
    );

    if (result.action === "enqueued") enqueued += 1;
    if (result.action === "repaired_failed") repaired += 1;
    if (result.action === "present") present += 1;

    if (result.queueState === "completed" || result.queueState === "failed") {
      await markQueueStateMismatch(job.id, result.queueState);
    }
  }

  logger.info("publishing_queue_reconciled", {
    scanned: jobs.length,
    enqueued,
    repaired,
    present,
  });
}

interface FailedPublishingQueueJob {
  id?: string;
  data: PublishingDispatchJob;
  attemptsMade: number;
  opts: {
    attempts?: number;
  };
}

async function recordDispatchFailure(
  job: FailedPublishingQueueJob | undefined,
  error: Error,
) {
  if (!job) return;

  const attemptsMade = Math.max(1, job.attemptsMade);
  const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
  const finalAttempt = isFinalPublishingAttempt(attemptsMade, maxAttempts);

  const updated = await prisma.publishingJob.updateMany({
    where: {
      id: job.data.publishingJobId,
      idempotencyKey: job.data.idempotencyKey,
      state: {
        in: ["SCHEDULED", "RETRY_WAIT"],
      },
    },
    data: {
      state: finalAttempt ? "NEEDS_ATTENTION" : "RETRY_WAIT",
      lockedAt: null,
      lastErrorCode: finalAttempt
        ? "QUEUE_DISPATCH_EXHAUSTED"
        : "QUEUE_DISPATCH_RETRY",
      lastErrorMessage: "Queue dispatch failed; inspect the stable error code",
    },
  });

  logger.error("publishing_dispatch_failed", {
    queueJobId: job.id,
    publishingJobId: job.data.publishingJobId,
    attemptsMade,
    maxAttempts,
    finalAttempt,
    dbUpdated: updated.count > 0,
    errorType: error.name,
  });
}

if (env.REDIS_URL) {
  publishingQueueClient = createPublishingQueueClient(env.REDIS_URL);

  publishingWorker = createPublishingWorker(
    env.REDIS_URL,
    async (job: PublishingDispatchJob, context: PublishingDispatchContext) => {
      const pending = await prisma.publishingJob.findUnique({
        where: { id: job.publishingJobId },
        select: {
          state: true,
          attemptCount: true,
          idempotencyKey: true,
          externalContainerId: true,
          externalMediaId: true,
          containerCreateIntentAt: true,
          publishIntentAt: true,
          reelProject: {
            select: {
              id: true,
              state: true,
              activeVersion: true,
              clientId: true,
              client: { select: { organizationId: true } },
            },
          },
          reelVersion: {
            select: {
              id: true,
              reelProjectId: true,
              version: true,
              renderedAssetId: true,
            },
          },
          socialAccount: {
            select: {
              id: true,
              clientId: true,
              status: true,
              accessTokenCiphertext: true,
              tokenExpiresAt: true,
            },
          },
        },
      });
      if (!pending || pending.idempotencyKey !== job.idempotencyKey) {
        throw new Error(
          `PublishingJob not found or mismatched: ${job.publishingJobId}`,
        );
      }
      if (pending.state !== "SCHEDULED" && pending.state !== "RETRY_WAIT") {
        logger.info("publishing_dispatch_skipped", {
          publishingJobId: job.publishingJobId,
          state: pending.state,
        });
        return;
      }
      const approval = await prisma.approval.findFirst({
        where: {
          reelProjectId: pending.reelProject.id,
          reelVersionId: pending.reelVersion.id,
          decision: "APPROVED",
        },
        select: { id: true },
      });
      const guardError =
        pending.attemptCount >= PUBLISHING_MAX_ATTEMPTS
          ? "QUEUE_DISPATCH_EXHAUSTED"
          : pending.externalContainerId ||
              pending.externalMediaId ||
              pending.containerCreateIntentAt ||
              pending.publishIntentAt
            ? "REMOTE_WRITE_INTENT_PRESENT"
            : publishingPreflightError({
                jobState: pending.state,
                jobProjectId: job.reelProjectId,
                jobVersionId: job.reelVersionId,
                jobAccountId: job.socialAccountId,
                project: {
                  id: pending.reelProject.id,
                  state: pending.reelProject.state,
                  activeVersion: pending.reelProject.activeVersion,
                  clientId: pending.reelProject.clientId,
                },
                version: pending.reelVersion,
                account: {
                  id: pending.socialAccount.id,
                  clientId: pending.socialAccount.clientId,
                  status: pending.socialAccount.status,
                  hasCredential: Boolean(
                    pending.socialAccount.accessTokenCiphertext,
                  ),
                  tokenExpiresAt: pending.socialAccount.tokenExpiresAt,
                },
                hasVersionApproval: Boolean(approval),
              });
      if (guardError) {
        const blocked = await prisma.$transaction(async (tx) => {
          const updated = await tx.publishingJob.updateMany({
            where: {
              id: job.publishingJobId,
              idempotencyKey: job.idempotencyKey,
              state: { in: ["SCHEDULED", "RETRY_WAIT"] },
            },
            data: {
              state: "NEEDS_ATTENTION",
              lockedAt: null,
              lastErrorCode: guardError,
              lastErrorMessage: "Publishing preflight rejected this job",
            },
          });
          if (updated.count > 0) {
            await tx.auditEvent.create({
              data: {
                organizationId: pending.reelProject.client.organizationId,
                clientId: pending.reelProject.clientId,
                actorType: "WORKER",
                action: "publishing.preflight_blocked",
                entityType: "PublishingJob",
                entityId: job.publishingJobId,
                metadata: { code: guardError },
              },
            });
          }
          return updated.count > 0;
        });
        logger.warn("publishing_preflight_blocked", {
          publishingJobId: job.publishingJobId,
          code: guardError,
          blocked,
        });
        return;
      }

      const claimed = await prisma.publishingJob.updateMany({
        where: {
          id: job.publishingJobId,
          idempotencyKey: job.idempotencyKey,
          state: {
            in: ["SCHEDULED", "RETRY_WAIT"],
          },
          attemptCount: { lt: PUBLISHING_MAX_ATTEMPTS },
          externalContainerId: null,
          externalMediaId: null,
          containerCreateIntentAt: null,
          publishIntentAt: null,
          reelProject: {
            state: "SCHEDULED",
            activeVersion: pending.reelVersion.version,
            clientId: pending.socialAccount.clientId,
            approvals: {
              some: {
                reelVersionId: job.reelVersionId,
                decision: "APPROVED",
              },
            },
          },
          reelVersion: {
            reelProjectId: job.reelProjectId,
            renderedAssetId: { not: null },
          },
          socialAccount: {
            clientId: pending.reelProject.clientId,
            status: "CONNECTED",
          },
        },
        data: {
          state: "DISPATCHED",
          lockedAt: new Date(),
          attemptCount: { increment: 1 },
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      if (claimed.count === 0) {
        const current = await prisma.publishingJob.findUnique({
          where: { id: job.publishingJobId },
          select: { state: true, idempotencyKey: true },
        });
        if (!current) {
          throw new Error(`PublishingJob not found: ${job.publishingJobId}`);
        }
        if (current.idempotencyKey !== job.idempotencyKey) {
          throw new Error(
            `PublishingJob idempotency mismatch: ${job.publishingJobId}`,
          );
        }

        logger.info("publishing_dispatch_skipped", {
          publishingJobId: job.publishingJobId,
          state: current.state,
        });
        return;
      }

      logger.info("publishing_dispatched", {
        queueJobId: context.queueJobId,
        publishingJobId: job.publishingJobId,
        reelVersionId: job.reelVersionId,
        socialAccountId: job.socialAccountId,
        attemptNumber: context.attemptNumber,
      });
      await prisma.publishingJob.updateMany({
        where: {
          id: job.publishingJobId,
          idempotencyKey: job.idempotencyKey,
          state: "DISPATCHED",
        },
        data: { lockedAt: null },
      });
    },
  );

  publishingWorker.on("active", (job) => {
    logger.info("publishing_dispatch_active", {
      queueJobId: job.id,
      publishingJobId: job.data.publishingJobId,
      attemptNumber: job.attemptsMade + 1,
    });
  });

  publishingWorker.on("completed", (job) => {
    logger.info("publishing_dispatch_completed", {
      queueJobId: job.id,
      publishingJobId: job.data.publishingJobId,
    });
  });

  publishingWorker.on("failed", (job, error) => {
    void recordDispatchFailure(job, error).catch((failure) => {
      logger.error("publishing_failure_bookkeeping_failed", {
        publishingJobId: job?.data.publishingJobId,
        errorType: failure instanceof Error ? failure.name : "UnknownError",
      });
    });
  });

  publishingWorker.on("stalled", (jobId) => {
    logger.warn("publishing_dispatch_stalled", { queueJobId: jobId });
  });

  publishingWorker.on("error", (error) => {
    logger.error("publishing_worker_error", { errorType: error.name });
  });

  void reconcilePublishingQueue().catch((error) => {
    logger.error("publishing_queue_reconcile_failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  });

  reconcileTimer = setInterval(() => {
    void reconcilePublishingQueue().catch((error) => {
      logger.error("publishing_queue_reconcile_failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
} else {
  logger.warn("publishing_worker_disabled", {
    reason: "REDIS_URL is not configured",
  });
}

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info("worker_stopping", { signal });

  try {
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (mediaCleanupTimer) clearInterval(mediaCleanupTimer);
    instagramTokenLifecycle.stop();
    await instagramInsightsCollector.stop();
    await publishingLifecycle?.stop();
    await publishingWorker?.close();
    await publishingQueueClient?.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error("worker_shutdown_failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
