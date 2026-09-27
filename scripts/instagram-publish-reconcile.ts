import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { prisma } from "@forge/database";
import {
  decryptSocialTokenFromKeyring,
  InstagramPublishingClient,
  parseSocialTokenPreviousKeys,
} from "@forge/social";

if (existsSync(".env")) loadEnvFile(".env");

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

async function main() {
  const [action, jobId, mediaId, actorId] = process.argv.slice(2);
  if (!jobId || !["status", "confirm-media"].includes(action ?? "")) {
    throw new Error(
      "Usage: npm run instagram:publish:reconcile -- status <job-id> | confirm-media <job-id> <media-id> <owner-or-admin-user-id>",
    );
  }
  const job = await prisma.publishingJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      state: true,
      reelVersionId: true,
      externalContainerId: true,
      externalMediaId: true,
      containerCreateIntentAt: true,
      publishIntentAt: true,
      lastErrorCode: true,
      scheduledAt: true,
      reelVersion: { select: { caption: true } },
      reelProject: {
        select: {
          clientId: true,
          client: { select: { organizationId: true } },
        },
      },
      socialAccount: {
        select: {
          clientId: true,
          status: true,
          accessTokenCiphertext: true,
        },
      },
    },
  });
  if (!job) throw new Error("Publishing job unavailable");
  if (action === "status") {
    process.stdout.write(
      JSON.stringify({
        jobId: job.id,
        state: job.state,
        reelVersionId: job.reelVersionId,
        externalContainerId: job.externalContainerId,
        externalMediaId: job.externalMediaId,
        containerCreateIntentAt: job.containerCreateIntentAt,
        publishIntentAt: job.publishIntentAt,
        lastErrorCode: job.lastErrorCode,
      }) + "\n",
    );
    return;
  }
  const confirmedMediaId = required(mediaId, "media-id");
  const operatorId = required(actorId, "owner-or-admin-user-id");
  if (!/^\d+$/.test(confirmedMediaId)) {
    throw new Error("media-id must be numeric");
  }
  const organizationId = job.reelProject.client.organizationId;
  const member = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: operatorId,
      },
    },
    select: { role: true },
  });
  if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
    throw new Error("Owner or admin membership required");
  }
  if (
    job.state !== "NEEDS_ATTENTION" ||
    !job.publishIntentAt ||
    !job.externalContainerId ||
    (job.externalMediaId !== null &&
      job.externalMediaId !== confirmedMediaId) ||
    job.reelProject.clientId !== job.socialAccount.clientId ||
    job.socialAccount.status !== "CONNECTED" ||
    !job.socialAccount.accessTokenCiphertext
  ) {
    throw new Error("This job has no eligible ambiguous publish to reconcile");
  }
  const key = required(
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY,
    "SOCIAL_TOKEN_ENCRYPTION_KEY",
  );
  const token = decryptSocialTokenFromKeyring(
    job.socialAccount.accessTokenCiphertext,
    key,
    parseSocialTokenPreviousKeys(process.env.SOCIAL_TOKEN_PREVIOUS_KEYS, key),
  ).plaintext;
  const provider = new InstagramPublishingClient(
    process.env.META_GRAPH_VERSION ?? "v26.0",
  );
  const remote = await provider.getPublishedMedia({
    mediaId: confirmedMediaId,
    accessToken: token,
  });
  const publishedAt =
    typeof remote.timestamp === "string" ? new Date(remote.timestamp) : null;
  if (
    remote.media_product_type !== "REELS" ||
    (typeof remote.caption === "string" ? remote.caption : "") !==
      (job.reelVersion.caption ?? "") ||
    !publishedAt ||
    !Number.isFinite(publishedAt.getTime()) ||
    publishedAt.getTime() < job.scheduledAt.getTime() - 60 * 60_000 ||
    publishedAt.getTime() > Date.now() + 5 * 60_000
  ) {
    throw new Error(
      "Remote reel does not match the expected product, caption, or time window",
    );
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.publishingJob.updateMany({
      where: {
        id: job.id,
        state: "NEEDS_ATTENTION",
        externalMediaId: job.externalMediaId,
        publishIntentAt: { not: null },
      },
      data: {
        state: "PROCESSING",
        externalMediaId: confirmedMediaId,
        nextPollAt: new Date(),
        lockedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (updated.count !== 1)
      throw new Error("Publishing job changed during reconciliation");
    await tx.auditEvent.create({
      data: {
        organizationId,
        clientId: job.reelProject.clientId,
        actorType: "USER",
        actorId: operatorId,
        action: "publishing.remote_media_confirmed",
        entityType: "PublishingJob",
        entityId: job.id,
        metadata: {
          externalMediaId: confirmedMediaId,
          remotePublishedAt: publishedAt.toISOString(),
        },
      },
    });
  });
  process.stdout.write(
    JSON.stringify({
      jobId: job.id,
      externalMediaId: confirmedMediaId,
      state: "PROCESSING",
    }) + "\n",
  );
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Reconciliation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
