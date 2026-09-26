import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { createLogger } from "@forge/logger";
import {
  createPublishingQueueClient,
  createPublishingWorker,
  isFinalPublishingAttempt,
  type PublishingDispatchContext,
  type PublishingDispatchJob,
} from "@forge/queue";
import { APP_NAME, PHASE } from "@forge/shared";
import { startInstagramTokenLifecycle } from "./instagram-token-lifecycle.js";
import {
  cleanupPublicationMedia,
  createTemporaryDelivery,
} from "./publication-media.js";

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

  const jobs = await prisma.publishingJob.findMany({
    where: {
      state: {
        in: ["SCHEDULED", "RETRY_WAIT"],
      },
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
      attemptCount: attemptsMade,
      lockedAt: null,
      lastErrorCode: finalAttempt
        ? "QUEUE_DISPATCH_EXHAUSTED"
        : "QUEUE_DISPATCH_RETRY",
      lastErrorMessage: error.message.slice(0, 2_000),
    },
  });

  logger.error("publishing_dispatch_failed", {
    queueJobId: job.id,
    publishingJobId: job.data.publishingJobId,
    attemptsMade,
    maxAttempts,
    finalAttempt,
    dbUpdated: updated.count > 0,
    error: error.message,
  });
}

if (env.REDIS_URL) {
  publishingQueueClient = createPublishingQueueClient(env.REDIS_URL);

  publishingWorker = createPublishingWorker(
    env.REDIS_URL,
    async (job: PublishingDispatchJob, context: PublishingDispatchContext) => {
      const claimed = await prisma.publishingJob.updateMany({
        where: {
          id: job.publishingJobId,
          idempotencyKey: job.idempotencyKey,
          state: {
            in: ["SCHEDULED", "RETRY_WAIT"],
          },
        },
        data: {
          state: "DISPATCHED",
          lockedAt: new Date(),
          attemptCount: context.attemptNumber,
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
        error: failure instanceof Error ? failure.message : String(failure),
      });
    });
  });

  publishingWorker.on("stalled", (jobId) => {
    logger.warn("publishing_dispatch_stalled", { queueJobId: jobId });
  });

  publishingWorker.on("error", (error) => {
    logger.error("publishing_worker_error", { error: error.message });
  });

  void reconcilePublishingQueue().catch((error) => {
    logger.error("publishing_queue_reconcile_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  reconcileTimer = setInterval(() => {
    void reconcilePublishingQueue().catch((error) => {
      logger.error("publishing_queue_reconcile_failed", {
        error: error instanceof Error ? error.message : String(error),
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
    await publishingWorker?.close();
    await publishingQueueClient?.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error("worker_shutdown_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
