import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { createLogger } from "@forge/logger";
import {
  decryptSocialTokenFromKeyring,
  InstagramPublishingClient,
  InstagramPublishingError,
  parseSocialTokenPreviousKeys,
} from "@forge/social";

const logger = createLogger("instagram-insights");
const DAY_MS = 24 * 60 * 60_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export function parseInsightsMetrics(value: string | undefined) {
  const metrics =
    value
      ?.split(",")
      .map((name) => name.trim())
      .filter(Boolean) ?? [];
  if (
    metrics.length === 0 ||
    metrics.length > 12 ||
    new Set(metrics).size !== metrics.length ||
    metrics.some((name) => !/^[a-z][a-z0-9_]{0,63}$/.test(name))
  ) {
    throw new Error(
      "INSTAGRAM_REEL_INSIGHTS_METRICS must contain 1–12 distinct metric names",
    );
  }
  return metrics;
}

export function nextInsightsCapture(publishedAt: Date, now: Date): Date | null {
  const ageMs = now.getTime() - publishedAt.getTime();
  if (ageMs >= 30 * DAY_MS) return null;
  return new Date(
    now.getTime() + (ageMs < 7 * DAY_MS ? 6 * 60 * 60_000 : DAY_MS),
  );
}

function errorCode(error: unknown) {
  if (error instanceof InstagramPublishingError) {
    return `INSIGHTS_${error.kind}`;
  }
  return "INSIGHTS_INTERNAL_ERROR";
}

async function markAttention(
  collectionId: string,
  lease: Date,
  organizationId: string,
  clientId: string,
  code: string,
) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.analyticsCollection.updateMany({
      where: {
        id: collectionId,
        lockedAt: lease,
        state: { in: ["PENDING", "RETRY_WAIT"] },
      },
      data: { state: "NEEDS_ATTENTION", lockedAt: null, lastErrorCode: code },
    });
    if (updated.count > 0) {
      await tx.auditEvent.create({
        data: {
          organizationId,
          clientId,
          actorType: "WORKER",
          action: "analytics.collection.needs_attention",
          entityType: "AnalyticsCollection",
          entityId: collectionId,
          metadata: { code },
        },
      });
    }
  });
}

async function seedPublishedJobs(now: Date) {
  const jobs = await prisma.publishingJob.findMany({
    where: {
      state: "PUBLISHED",
      publishedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) },
      externalMediaId: { not: null },
      analyticsCollection: null,
    },
    select: { id: true, publishedAt: true },
    orderBy: { publishedAt: "asc" },
    take: 100,
  });
  await prisma.analyticsCollection.createMany({
    data: jobs
      .filter((job) => job.publishedAt !== null)
      .map((job) => ({
        publishingJobId: job.id,
        nextCaptureAt: new Date(job.publishedAt!.getTime() + 60 * 60_000),
      })),
    skipDuplicates: true,
  });
}

export async function captureInstagramInsights(
  collectionId: string,
  metrics: string[],
  provider = new InstagramPublishingClient(env.META_GRAPH_VERSION),
) {
  const now = new Date();
  const previous = await prisma.analyticsCollection.findUnique({
    where: { id: collectionId },
    select: { captureStartedAt: true },
  });
  if (!previous) return;
  const claimed = await prisma.analyticsCollection.updateMany({
    where: {
      id: collectionId,
      state: { in: ["PENDING", "RETRY_WAIT"] },
      nextCaptureAt: { lte: now },
      OR: [
        { lockedAt: null },
        { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
      ],
      captureStartedAt: previous.captureStartedAt,
    },
    data: { lockedAt: now, captureStartedAt: previous.captureStartedAt ?? now },
  });
  if (claimed.count !== 1) return;
  const collection = await prisma.analyticsCollection.findUnique({
    where: { id: collectionId },
    select: {
      id: true,
      publishingJobId: true,
      captureStartedAt: true,
      attemptCount: true,
      publishingJob: {
        select: {
          state: true,
          publishedAt: true,
          externalMediaId: true,
          reelProject: {
            select: {
              clientId: true,
              client: { select: { organizationId: true } },
            },
          },
          socialAccount: {
            select: {
              id: true,
              clientId: true,
              status: true,
              accessTokenCiphertext: true,
              tokenExpiresAt: true,
              scopes: true,
            },
          },
        },
      },
    },
  });
  if (!collection) return;
  const job = collection.publishingJob;
  const clientId = job.reelProject.clientId;
  const organizationId = job.reelProject.client.organizationId;
  if (
    job.state !== "PUBLISHED" ||
    !job.publishedAt ||
    !job.externalMediaId ||
    job.socialAccount.clientId !== clientId ||
    job.socialAccount.status !== "CONNECTED" ||
    !job.socialAccount.accessTokenCiphertext ||
    !job.socialAccount.scopes.includes("instagram_business_basic") ||
    !job.socialAccount.scopes.includes("instagram_business_manage_insights") ||
    (job.socialAccount.tokenExpiresAt !== null &&
      job.socialAccount.tokenExpiresAt <= now) ||
    !env.SOCIAL_TOKEN_ENCRYPTION_KEY
  ) {
    await markAttention(
      collection.id,
      now,
      organizationId,
      clientId,
      "INSIGHTS_PREFLIGHT_FAILED",
    );
    return;
  }
  try {
    const token = decryptSocialTokenFromKeyring(
      job.socialAccount.accessTokenCiphertext,
      env.SOCIAL_TOKEN_ENCRYPTION_KEY,
      parseSocialTokenPreviousKeys(
        env.SOCIAL_TOKEN_PREVIOUS_KEYS,
        env.SOCIAL_TOKEN_ENCRYPTION_KEY,
      ),
    ).plaintext;
    const providerData = await provider.getMediaInsights({
      mediaId: job.externalMediaId,
      accessToken: token,
      metrics,
    });
    const collectedAt = new Date();
    const next = nextInsightsCapture(job.publishedAt, collectedAt);
    await prisma.$transaction(async (tx) => {
      const inserted = await tx.reelAnalyticsSnapshot.createMany({
        data: [
          {
            publishingJobId: collection.publishingJobId,
            capturedAt: collection.captureStartedAt!,
            metrics: {
              schemaVersion: "instagram-insights-v1",
              graphVersion: env.META_GRAPH_VERSION,
              requestedMetrics: metrics,
              period: "day",
              providerData,
              collectedAt: collectedAt.toISOString(),
            },
          },
        ],
        skipDuplicates: true,
      });
      const updated = await tx.analyticsCollection.updateMany({
        where: {
          id: collection.id,
          lockedAt: now,
          state: { in: ["PENDING", "RETRY_WAIT"] },
        },
        data: {
          state: next ? "PENDING" : "COMPLETE",
          nextCaptureAt: next ?? collectedAt,
          captureStartedAt: null,
          attemptCount: 0,
          capturedCount: { increment: inserted.count },
          lastErrorCode: null,
          lockedAt: null,
        },
      });
      if (updated.count !== 1)
        throw new Error("Analytics collection lease changed");
      if (inserted.count > 0) {
        await tx.auditEvent.create({
          data: {
            organizationId,
            clientId,
            actorType: "WORKER",
            action: "analytics.snapshot.captured",
            entityType: "ReelAnalyticsSnapshot",
            entityId: collection.publishingJobId,
            metadata: {
              requestedMetrics: metrics,
              capturedAt: collection.captureStartedAt!.toISOString(),
            },
          },
        });
      }
    });
  } catch (error) {
    const kind =
      error instanceof InstagramPublishingError ? error.kind : "TRANSIENT";
    if (kind === "AUTH") {
      await prisma.socialAccount.updateMany({
        where: { id: job.socialAccount.id, clientId },
        data: { status: "NEEDS_REAUTH", lastAuthErrorCode: errorCode(error) },
      });
    }
    if (
      kind === "AUTH" ||
      kind === "PERMANENT" ||
      collection.attemptCount + 1 >= MAX_ATTEMPTS
    ) {
      await markAttention(
        collection.id,
        now,
        organizationId,
        clientId,
        errorCode(error),
      );
      return;
    }
    const delay =
      kind === "RATE_LIMIT"
        ? 15 * 60_000
        : Math.min(60 * 60_000, 60_000 * 2 ** collection.attemptCount);
    await prisma.analyticsCollection.updateMany({
      where: {
        id: collection.id,
        lockedAt: now,
        state: { in: ["PENDING", "RETRY_WAIT"] },
      },
      data: {
        state: "RETRY_WAIT",
        nextCaptureAt: new Date(Date.now() + delay),
        attemptCount: { increment: 1 },
        lastErrorCode: errorCode(error),
        lockedAt: null,
      },
    });
  }
}

export function startInstagramInsightsCollector() {
  if (!env.INSTAGRAM_INSIGHTS_ENABLED) return { async stop() {} };
  const metrics = parseInsightsMetrics(env.INSTAGRAM_REEL_INSIGHTS_METRICS);
  let inFlight: Promise<void> | null = null;
  const run = async () => {
    try {
      const now = new Date();
      await seedPublishedJobs(now);
      const due = await prisma.analyticsCollection.findMany({
        where: {
          state: { in: ["PENDING", "RETRY_WAIT"] },
          nextCaptureAt: { lte: now },
          OR: [
            { lockedAt: null },
            { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
          ],
        },
        select: { id: true },
        orderBy: [{ nextCaptureAt: "asc" }, { id: "asc" }],
        take: 25,
      });
      for (const row of due) await captureInstagramInsights(row.id, metrics);
    } catch (error) {
      logger.error("instagram_insights_scan_failed", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  };
  const trigger = () => {
    if (inFlight) return;
    inFlight = run().finally(() => {
      inFlight = null;
    });
  };
  trigger();
  const timer = setInterval(trigger, 60_000);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await inFlight;
    },
  };
}
