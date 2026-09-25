import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { createLogger } from "@forge/logger";
import {
  createPublishingWorker,
  type PublishingDispatchJob,
} from "@forge/queue";
import { APP_NAME, PHASE } from "@forge/shared";

const logger = createLogger("worker");

logger.info("worker_started", {
  app: APP_NAME,
  phase: PHASE,
  environment: env.NODE_ENV,
});

let publishingWorker: ReturnType<typeof createPublishingWorker> | null = null;

if (env.REDIS_URL) {
  publishingWorker = createPublishingWorker(
    env.REDIS_URL,
    async (job: PublishingDispatchJob) => {
      const claimed = await prisma.publishingJob.updateMany({
        where: {
          id: job.publishingJobId,
          idempotencyKey: job.idempotencyKey,
          state: "SCHEDULED",
        },
        data: {
          state: "DISPATCHED",
          lockedAt: new Date(),
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
        publishingJobId: job.publishingJobId,
        reelVersionId: job.reelVersionId,
        socialAccountId: job.socialAccountId,
      });
    },
  );

  publishingWorker.on("failed", (job, error) => {
    logger.error("publishing_dispatch_failed", {
      jobId: job?.id,
      publishingJobId: job?.data.publishingJobId,
      error: error.message,
    });
  });

  publishingWorker.on("error", (error) => {
    logger.error("publishing_worker_error", { error: error.message });
  });
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
    await publishingWorker?.close();
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
