import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { createLogger } from "@forge/logger";
import {
  decryptSocialTokenFromKeyring,
  InstagramPublishingClient,
  InstagramPublishingError,
  parseSocialTokenPreviousKeys,
} from "@forge/social";
import type { MediaStorage, TemporaryMediaDelivery } from "@forge/storage";
import { preparePublicationMedia } from "./publication-media.js";

const logger = createLogger("instagram-publishing");
const LEASE_MS = 30 * 60_000;
const POLL_MS = 30_000;
const MAX_POLLS = 60;

export function nextPublishingAction(input: {
  externalContainerId: string | null;
  externalMediaId: string | null;
  containerCreateIntentAt: Date | null;
  publishIntentAt: Date | null;
}):
  | "CREATE_CONTAINER"
  | "POLL_CONTAINER"
  | "VERIFY_MEDIA"
  | "QUARANTINE_CREATE"
  | "QUARANTINE_PUBLISH" {
  if (input.externalMediaId) return "VERIFY_MEDIA";
  if (!input.externalContainerId) {
    return input.containerCreateIntentAt
      ? "QUARANTINE_CREATE"
      : "CREATE_CONTAINER";
  }
  return input.publishIntentAt ? "QUARANTINE_PUBLISH" : "POLL_CONTAINER";
}

export function nextContainerAction(input: {
  status: string;
  pollCount: number;
}): "WAIT" | "PUBLISH" | "ATTENTION" {
  if (input.status === "FINISHED") return "PUBLISH";
  if (input.pollCount >= MAX_POLLS) return "ATTENTION";
  if (input.status === "IN_PROGRESS") return "WAIT";
  return "ATTENTION";
}

function safeCode(error: unknown) {
  if (error instanceof InstagramPublishingError) {
    return `${error.operation.toUpperCase().replaceAll(".", "_")}_${error.kind}`;
  }
  return "PUBLISHING_INTERNAL_ERROR";
}

async function attention(
  jobId: string,
  lease: Date,
  organizationId: string,
  clientId: string,
  code: string,
) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.publishingJob.updateMany({
      where: {
        id: jobId,
        lockedAt: lease,
        state: { in: ["DISPATCHED", "PROCESSING"] },
      },
      data: {
        state: "NEEDS_ATTENTION",
        lockedAt: null,
        nextPollAt: null,
        lastErrorCode: code,
        lastErrorMessage: "Publishing requires operator reconciliation",
      },
    });
    if (updated.count > 0) {
      await tx.auditEvent.create({
        data: {
          organizationId,
          clientId,
          actorType: "WORKER",
          action: "publishing.needs_attention",
          entityType: "PublishingJob",
          entityId: jobId,
          metadata: { code },
        },
      });
    }
  });
  logger.warn("instagram_publishing_needs_attention", { jobId, code });
}

async function retryRead(
  jobId: string,
  lease: Date,
  pollCount: number,
  error: unknown,
) {
  const rateLimit =
    error instanceof InstagramPublishingError && error.kind === "RATE_LIMIT";
  const delay = rateLimit
    ? 120_000
    : Math.min(10 * 60_000, 15_000 * 2 ** Math.min(pollCount, 5));
  await prisma.publishingJob.updateMany({
    where: { id: jobId, lockedAt: lease, state: "PROCESSING" },
    data: {
      lockedAt: null,
      nextPollAt: new Date(Date.now() + delay),
      lastErrorCode: safeCode(error),
      lastErrorMessage: "Instagram read will be retried",
    },
  });
}

export async function advanceInstagramPublishingJob(
  jobId: string,
  canonicalStorage: MediaStorage,
  delivery: TemporaryMediaDelivery,
  provider = new InstagramPublishingClient(env.META_GRAPH_VERSION),
) {
  if (!env.INSTAGRAM_LIVE_PUBLISH_ENABLED) return;
  const now = new Date();
  const lease = await prisma.publishingJob.updateMany({
    where: {
      id: jobId,
      state: { in: ["DISPATCHED", "PROCESSING"] },
      OR: [
        { lockedAt: null },
        { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
      ],
      AND: [{ OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }] }],
    },
    data: { lockedAt: now },
  });
  if (lease.count !== 1) return;

  const job = await prisma.publishingJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      state: true,
      reelProjectId: true,
      reelVersionId: true,
      externalContainerId: true,
      externalMediaId: true,
      containerCreateIntentAt: true,
      publishIntentAt: true,
      mediaPrepareAttemptCount: true,
      containerPollCount: true,
      reelProject: {
        select: {
          clientId: true,
          state: true,
          activeVersion: true,
          client: { select: { organizationId: true } },
        },
      },
      reelVersion: {
        select: {
          version: true,
          reelProjectId: true,
          renderedAssetId: true,
          caption: true,
        },
      },
      socialAccount: {
        select: {
          id: true,
          clientId: true,
          providerAccountId: true,
          status: true,
          accessTokenCiphertext: true,
          tokenExpiresAt: true,
          scopes: true,
        },
      },
    },
  });
  if (!job) return;
  const clientId = job.reelProject.clientId;
  const organizationId = job.reelProject.client.organizationId;
  try {
    const approved = await prisma.approval.findFirst({
      where: {
        reelProjectId: job.reelProjectId,
        reelVersionId: job.reelVersionId,
      },
      select: { decision: true },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    });
    const invalid =
      (job.reelProject.state !== "SCHEDULED" &&
        job.reelProject.state !== "PUBLISHING") ||
      job.reelProject.activeVersion !== job.reelVersion.version ||
      job.reelVersion.reelProjectId !== job.reelProjectId ||
      !job.reelVersion.renderedAssetId ||
      job.socialAccount.clientId !== clientId ||
      job.socialAccount.status !== "CONNECTED" ||
      !job.socialAccount.accessTokenCiphertext ||
      !job.socialAccount.scopes.includes("instagram_business_basic") ||
      !job.socialAccount.scopes.includes(
        "instagram_business_content_publish",
      ) ||
      (job.socialAccount.tokenExpiresAt !== null &&
        job.socialAccount.tokenExpiresAt <= now) ||
      approved?.decision !== "APPROVED";
    if (invalid) {
      await attention(
        job.id,
        now,
        organizationId,
        clientId,
        "PUBLISHING_PREFLIGHT_FAILED",
      );
      return;
    }
    if (!env.SOCIAL_TOKEN_ENCRYPTION_KEY) {
      await attention(
        job.id,
        now,
        organizationId,
        clientId,
        "PUBLISHING_KEY_UNAVAILABLE",
      );
      return;
    }
    const previousKeys = parseSocialTokenPreviousKeys(
      env.SOCIAL_TOKEN_PREVIOUS_KEYS,
      env.SOCIAL_TOKEN_ENCRYPTION_KEY,
    );
    const accessToken = decryptSocialTokenFromKeyring(
      job.socialAccount.accessTokenCiphertext!,
      env.SOCIAL_TOKEN_ENCRYPTION_KEY,
      previousKeys,
    ).plaintext;

    if (
      (job.externalContainerId &&
        !job.externalMediaId &&
        job.containerCreateIntentAt &&
        now.getTime() - job.containerCreateIntentAt.getTime() > 60 * 60_000) ||
      (job.externalMediaId &&
        job.publishIntentAt &&
        now.getTime() - job.publishIntentAt.getTime() > 60 * 60_000)
    ) {
      await attention(
        job.id,
        now,
        organizationId,
        clientId,
        "PUBLISHING_VERIFICATION_TIMEOUT",
      );
      return;
    }

    const action = nextPublishingAction(job);
    if (action === "VERIFY_MEDIA" && job.externalMediaId) {
      let remote: Record<string, unknown>;
      try {
        remote = await provider.getPublishedMedia({
          mediaId: job.externalMediaId,
          accessToken,
        });
      } catch (error) {
        if (
          error instanceof InstagramPublishingError &&
          ["TRANSIENT", "RATE_LIMIT"].includes(error.kind)
        ) {
          await retryRead(job.id, now, job.containerPollCount, error);
          return;
        }
        throw error;
      }
      const remotePublishedAt =
        typeof remote.timestamp === "string"
          ? new Date(remote.timestamp)
          : null;
      if (
        remote.media_product_type !== "REELS" ||
        !remotePublishedAt ||
        !Number.isFinite(remotePublishedAt.getTime())
      ) {
        await attention(
          job.id,
          now,
          organizationId,
          clientId,
          "REMOTE_MEDIA_VERIFICATION_FAILED",
        );
        return;
      }
      await prisma.$transaction(async (tx) => {
        const completed = await tx.publishingJob.updateMany({
          where: {
            id: job.id,
            lockedAt: now,
            state: "PROCESSING",
            externalMediaId: job.externalMediaId,
          },
          data: {
            state: "PUBLISHED",
            publishedAt: remotePublishedAt,
            lockedAt: null,
            nextPollAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        if (completed.count > 0) {
          await tx.reelProject.updateMany({
            where: {
              id: job.reelProjectId,
              activeVersion: job.reelVersion.version,
              state: { in: ["SCHEDULED", "PUBLISHING"] },
            },
            data: { state: "PUBLISHED" },
          });
          await tx.auditEvent.create({
            data: {
              organizationId,
              clientId,
              actorType: "WORKER",
              action: "publishing.verified",
              entityType: "PublishingJob",
              entityId: job.id,
              metadata: { externalMediaId: job.externalMediaId },
            },
          });
        }
      });
      return;
    }

    if (action === "QUARANTINE_CREATE") {
      await attention(
        job.id,
        now,
        organizationId,
        clientId,
        "CONTAINER_CREATE_OUTCOME_UNKNOWN",
      );
      return;
    }
    if (action === "CREATE_CONTAINER") {
      let videoUrl: string;
      try {
        videoUrl = await preparePublicationMedia(
          job.id,
          canonicalStorage,
          delivery,
        );
      } catch {
        if (job.mediaPrepareAttemptCount >= 4) {
          await attention(
            job.id,
            now,
            organizationId,
            clientId,
            "MEDIA_PREPARATION_EXHAUSTED",
          );
        } else {
          await prisma.publishingJob.updateMany({
            where: {
              id: job.id,
              lockedAt: now,
              state: "DISPATCHED",
              containerCreateIntentAt: null,
            },
            data: {
              mediaPrepareAttemptCount: { increment: 1 },
              nextPollAt: new Date(
                Date.now() + 60_000 * 2 ** job.mediaPrepareAttemptCount,
              ),
              lockedAt: null,
              lastErrorCode: "MEDIA_PREPARATION_RETRY",
              lastErrorMessage: "Temporary media preparation will be retried",
            },
          });
        }
        return;
      }
      const intent = await prisma.publishingJob.updateMany({
        where: {
          id: job.id,
          lockedAt: now,
          state: "DISPATCHED",
          containerCreateIntentAt: null,
          externalContainerId: null,
        },
        data: { state: "PROCESSING", containerCreateIntentAt: new Date() },
      });
      if (intent.count !== 1) return;
      await prisma.reelProject.updateMany({
        where: {
          id: job.reelProjectId,
          activeVersion: job.reelVersion.version,
          state: "SCHEDULED",
        },
        data: { state: "PUBLISHING" },
      });
      const containerId = await provider.createReelContainer({
        accountId: job.socialAccount.providerAccountId,
        accessToken,
        videoUrl,
        caption: job.reelVersion.caption,
      });
      await prisma.publishingJob.updateMany({
        where: {
          id: job.id,
          lockedAt: now,
          state: "PROCESSING",
          externalContainerId: null,
        },
        data: {
          externalContainerId: containerId,
          lockedAt: null,
          nextPollAt: new Date(Date.now() + POLL_MS),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      logger.info("instagram_container_created", { jobId: job.id });
      return;
    }

    if (action === "QUARANTINE_PUBLISH") {
      await attention(
        job.id,
        now,
        organizationId,
        clientId,
        "MEDIA_PUBLISH_OUTCOME_UNKNOWN",
      );
      return;
    }
    if (!job.externalContainerId) {
      await attention(
        job.id,
        now,
        organizationId,
        clientId,
        "CONTAINER_ID_MISSING",
      );
      return;
    }
    let status: string;
    try {
      status = await provider.getContainerStatus({
        containerId: job.externalContainerId,
        accessToken,
      });
    } catch (error) {
      if (
        error instanceof InstagramPublishingError &&
        ["TRANSIENT", "RATE_LIMIT"].includes(error.kind)
      ) {
        await retryRead(job.id, now, job.containerPollCount, error);
        return;
      }
      throw error;
    }
    const next = nextContainerAction({
      status,
      pollCount: job.containerPollCount + 1,
    });
    if (next === "ATTENTION") {
      await attention(
        job.id,
        now,
        organizationId,
        clientId,
        `CONTAINER_${status.replace(/[^A-Z_]/g, "").slice(0, 24) || "UNKNOWN"}`,
      );
      return;
    }
    if (next === "WAIT") {
      await prisma.publishingJob.updateMany({
        where: { id: job.id, lockedAt: now, state: "PROCESSING" },
        data: {
          containerPollCount: { increment: 1 },
          nextPollAt: new Date(Date.now() + POLL_MS),
          lockedAt: null,
        },
      });
      return;
    }
    const intent = await prisma.publishingJob.updateMany({
      where: {
        id: job.id,
        lockedAt: now,
        state: "PROCESSING",
        publishIntentAt: null,
      },
      data: {
        publishIntentAt: new Date(),
        containerPollCount: { increment: 1 },
      },
    });
    if (intent.count !== 1) return;
    const mediaId = await provider.publishReel({
      accountId: job.socialAccount.providerAccountId,
      containerId: job.externalContainerId,
      accessToken,
    });
    await prisma.publishingJob.updateMany({
      where: {
        id: job.id,
        lockedAt: now,
        state: "PROCESSING",
        externalMediaId: null,
      },
      data: {
        externalMediaId: mediaId,
        lockedAt: null,
        nextPollAt: new Date(Date.now() + POLL_MS),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    logger.info("instagram_publish_acknowledged", { jobId: job.id });
  } catch (error) {
    if (error instanceof InstagramPublishingError && error.kind === "AUTH") {
      await prisma.socialAccount.updateMany({
        where: { id: job.socialAccount.id, clientId },
        data: { status: "NEEDS_REAUTH", lastAuthErrorCode: safeCode(error) },
      });
    }
    await attention(job.id, now, organizationId, clientId, safeCode(error));
  }
}

export function startInstagramPublishingLifecycle(
  canonicalStorage: MediaStorage,
  delivery: TemporaryMediaDelivery,
) {
  if (!env.INSTAGRAM_LIVE_PUBLISH_ENABLED) {
    logger.info("instagram_live_publishing_disabled");
    return { async stop() {} };
  }
  let inFlight: Promise<void> | null = null;
  const run = async () => {
    try {
      const now = new Date();
      const jobs = await prisma.publishingJob.findMany({
        where: {
          state: { in: ["DISPATCHED", "PROCESSING"] },
          OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
          AND: [
            {
              OR: [
                { lockedAt: null },
                { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
              ],
            },
          ],
        },
        select: { id: true },
        orderBy: [{ nextPollAt: "asc" }, { createdAt: "asc" }],
        take: 50,
      });
      for (const job of jobs) {
        await advanceInstagramPublishingJob(job.id, canonicalStorage, delivery);
      }
    } catch (error) {
      logger.error("instagram_lifecycle_scan_failed", {
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
  const timer = setInterval(trigger, POLL_MS);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await inFlight;
    },
  };
}
