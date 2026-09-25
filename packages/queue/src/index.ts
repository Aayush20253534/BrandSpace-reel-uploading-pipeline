import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const PUBLISHING_QUEUE_NAME = "forge-publishing" as const;
export const PUBLISHING_DISPATCH_JOB_NAME = "publishing.dispatch" as const;
export const PUBLISHING_MAX_ATTEMPTS = 5;
export const PUBLISHING_RETRY_DELAY_MS = 5_000;

export interface PublishingDispatchJob {
  publishingJobId: string;
  reelProjectId: string;
  reelVersionId: string;
  socialAccountId: string;
  idempotencyKey: string;
}

export interface PublishingDispatchContext {
  attemptNumber: number;
  maxAttempts: number;
  queueJobId: string | undefined;
}

export type PublishingQueueReconcileAction =
  "enqueued" | "present" | "repaired_failed";

export interface PublishingQueueReconcileResult {
  action: PublishingQueueReconcileAction;
  queueJobId: string;
  queueState: string;
}

export function publishingQueueJobId(publishingJobId: string) {
  return `publishing-${publishingJobId}`;
}

export function delayUntil(scheduledAt: Date, now = new Date()) {
  return Math.max(0, scheduledAt.getTime() - now.getTime());
}

export function isFinalPublishingAttempt(
  attemptsMade: number,
  maxAttempts = PUBLISHING_MAX_ATTEMPTS,
) {
  return attemptsMade >= Math.max(1, maxAttempts);
}

function publishingJobOptions(scheduledAt: Date): JobsOptions {
  return {
    delay: delayUntil(scheduledAt),
    attempts: PUBLISHING_MAX_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: PUBLISHING_RETRY_DELAY_MS,
    },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  };
}

const producerConnection = (redisUrl: string) =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });

const workerConnection = (redisUrl: string) =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

export function createPublishingQueueClient(redisUrl: string) {
  const connection = producerConnection(redisUrl);
  const queue = new Queue<PublishingDispatchJob>(PUBLISHING_QUEUE_NAME, {
    connection,
  });

  const add = (data: PublishingDispatchJob, scheduledAt: Date) =>
    queue.add(PUBLISHING_DISPATCH_JOB_NAME, data, {
      ...publishingJobOptions(scheduledAt),
      jobId: publishingQueueJobId(data.publishingJobId),
    });

  return {
    async enqueue(data: PublishingDispatchJob, scheduledAt: Date) {
      return add(data, scheduledAt);
    },

    async reconcile(
      data: PublishingDispatchJob,
      scheduledAt: Date,
      options: { repairFailed?: boolean } = {},
    ): Promise<PublishingQueueReconcileResult> {
      const queueJobId = publishingQueueJobId(data.publishingJobId);
      const existing = await queue.getJob(queueJobId);

      if (!existing) {
        const created = await add(data, scheduledAt);
        return {
          action: "enqueued",
          queueJobId: created.id ?? queueJobId,
          queueState: await created.getState(),
        };
      }

      const state = await existing.getState();
      if (
        (state !== "failed" && state !== "unknown") ||
        !options.repairFailed
      ) {
        return {
          action: "present",
          queueJobId: existing.id ?? queueJobId,
          queueState: state,
        };
      }

      // Failed jobs are repaired only when an operator explicitly requests it.
      // Automatic reconciliation must never create an infinite retry loop after
      // BullMQ has exhausted the configured attempt budget.
      try {
        await existing.remove();
      } catch {
        // Another reconciler may already have removed or replaced it.
      }

      const replacement = await queue.getJob(queueJobId);
      if (replacement) {
        return {
          action: "present",
          queueJobId: replacement.id ?? queueJobId,
          queueState: await replacement.getState(),
        };
      }

      const repaired = await add(data, scheduledAt);
      return {
        action: "repaired_failed",
        queueJobId: repaired.id ?? queueJobId,
        queueState: await repaired.getState(),
      };
    },

    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}

export async function enqueuePublishingDispatch(
  redisUrl: string,
  data: PublishingDispatchJob,
  scheduledAt: Date,
) {
  const client = createPublishingQueueClient(redisUrl);

  try {
    return await client.enqueue(data, scheduledAt);
  } finally {
    await client.close();
  }
}

export function createPublishingWorker(
  redisUrl: string,
  processor: (
    data: PublishingDispatchJob,
    context: PublishingDispatchContext,
  ) => Promise<void>,
) {
  const connection = workerConnection(redisUrl);

  const worker = new Worker<PublishingDispatchJob>(
    PUBLISHING_QUEUE_NAME,
    async (job) => {
      if (job.name !== PUBLISHING_DISPATCH_JOB_NAME) {
        throw new Error(`Unsupported publishing job: ${job.name}`);
      }

      const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
      await processor(job.data, {
        attemptNumber: job.attemptsMade + 1,
        maxAttempts,
        queueJobId: job.id,
      });
    },
    {
      connection,
      concurrency: 4,
    },
  );

  worker.on("closed", () => {
    void connection.quit().catch(() => undefined);
  });

  return worker;
}
