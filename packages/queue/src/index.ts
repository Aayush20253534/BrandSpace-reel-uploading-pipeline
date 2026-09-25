import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const PUBLISHING_QUEUE_NAME = "forge-publishing" as const;
export const PUBLISHING_DISPATCH_JOB_NAME = "publishing.dispatch" as const;

export interface PublishingDispatchJob {
  publishingJobId: string;
  reelProjectId: string;
  reelVersionId: string;
  socialAccountId: string;
  idempotencyKey: string;
}

export function publishingQueueJobId(publishingJobId: string) {
  return `publishing-${publishingJobId}`;
}

export function delayUntil(scheduledAt: Date, now = new Date()) {
  return Math.max(0, scheduledAt.getTime() - now.getTime());
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

export async function enqueuePublishingDispatch(
  redisUrl: string,
  data: PublishingDispatchJob,
  scheduledAt: Date,
) {
  const connection = producerConnection(redisUrl);
  const queue = new Queue<PublishingDispatchJob>(PUBLISHING_QUEUE_NAME, {
    connection,
  });

  const options: JobsOptions = {
    jobId: publishingQueueJobId(data.publishingJobId),
    delay: delayUntil(scheduledAt),
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  };

  try {
    return await queue.add(PUBLISHING_DISPATCH_JOB_NAME, data, options);
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export function createPublishingWorker(
  redisUrl: string,
  processor: (data: PublishingDispatchJob) => Promise<void>,
) {
  const connection = workerConnection(redisUrl);

  const worker = new Worker<PublishingDispatchJob>(
    PUBLISHING_QUEUE_NAME,
    async (job) => {
      if (job.name !== PUBLISHING_DISPATCH_JOB_NAME) {
        throw new Error(`Unsupported publishing job: ${job.name}`);
      }
      await processor(job.data);
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
