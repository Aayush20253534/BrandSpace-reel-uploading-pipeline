import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";
import { createPublishingQueueClient } from "../packages/queue/src/index.ts";

loadEnvFile(".env");

const rawBatchSize = process.argv[2]?.trim();
const batchSize = rawBatchSize ? Number.parseInt(rawBatchSize, 10) : 250;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 2_000) {
  throw new Error("batch-size must be an integer between 1 and 2000");
}

async function main() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for queue reconciliation");
  }

  const queue = createPublishingQueueClient(redisUrl);

  try {
    const jobs = await prisma.publishingJob.findMany({
      where: {
        state: {
          in: ["SCHEDULED", "RETRY_WAIT"],
        },
      },
      select: {
        id: true,
        reelProjectId: true,
        reelVersionId: true,
        socialAccountId: true,
        idempotencyKey: true,
        scheduledAt: true,
        state: true,
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      take: batchSize,
    });

    const summary = {
      scanned: jobs.length,
      enqueued: 0,
      repairedFailed: 0,
      present: 0,
      needsAttention: 0,
    };

    for (const job of jobs) {
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

      if (result.action === "enqueued") summary.enqueued += 1;
      if (result.action === "repaired_failed") summary.repairedFailed += 1;
      if (result.action === "present") summary.present += 1;

      if (result.queueState === "completed") {
        const updated = await prisma.publishingJob.updateMany({
          where: {
            id: job.id,
            state: {
              in: ["SCHEDULED", "RETRY_WAIT"],
            },
          },
          data: {
            state: "NEEDS_ATTENTION",
            lockedAt: null,
            lastErrorCode: "QUEUE_DB_STATE_MISMATCH",
            lastErrorMessage:
              "BullMQ job is completed while PostgreSQL is still pending",
          },
        });
        summary.needsAttention += updated.count;
      }

      console.log(
        JSON.stringify({
          publishingJobId: job.id,
          dbState: job.state,
          queueJobId: result.queueJobId,
          queueState: result.queueState,
          action: result.action,
        }),
      );
    }

    console.log("[reel:queue:reconcile] complete");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await queue.close();
  }
}

main()
  .catch((error: unknown) => {
    console.error("[reel:queue:reconcile] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
