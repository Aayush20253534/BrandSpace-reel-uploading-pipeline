import { loadEnvFile } from "node:process";
import { Prisma, prisma } from "../packages/database/src/index.ts";
import { buildPublishingIdempotencyKey } from "../packages/domain/src/index.ts";
import { enqueuePublishingDispatch } from "../packages/queue/src/index.ts";
import { assertSocialAccountSchedulable } from "../packages/social/src/index.ts";

loadEnvFile(".env");

const reelProjectId = process.argv[2]?.trim() ?? "";
const socialAccountId = process.argv[3]?.trim() ?? "";
const scheduledAtRaw = process.argv[4]?.trim() ?? "";

if (!reelProjectId || !socialAccountId || !scheduledAtRaw) {
  console.error(
    "Usage: npm run reel:schedule -- <reel-project-id> <social-account-id> <scheduled-at-iso>",
  );
  process.exit(1);
}

const scheduledAt = new Date(scheduledAtRaw);
if (Number.isNaN(scheduledAt.getTime())) {
  throw new Error(`Invalid scheduled-at timestamp: ${scheduledAtRaw}`);
}
if (scheduledAt.getTime() <= Date.now()) {
  throw new Error("scheduled-at must be in the future");
}

async function main() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for reel scheduling");
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const project = await tx.reelProject.findUnique({
        where: { id: reelProjectId },
        select: {
          id: true,
          state: true,
          activeVersion: true,
          client: {
            select: {
              id: true,
              organizationId: true,
              approvalMode: true,
            },
          },
        },
      });
      if (!project) throw new Error(`ReelProject not found: ${reelProjectId}`);
      if (project.state !== "APPROVED" && project.state !== "SCHEDULED") {
        throw new Error(
          `ReelProject ${project.id} must be APPROVED or SCHEDULED before scheduling`,
        );
      }

      const version = await tx.reelVersion.findUnique({
        where: {
          reelProjectId_version: {
            reelProjectId: project.id,
            version: project.activeVersion,
          },
        },
        select: {
          id: true,
          renderedAssetId: true,
        },
      });
      if (!version) {
        throw new Error(
          `Active ReelVersion ${project.activeVersion} was not found`,
        );
      }
      if (!version.renderedAssetId) {
        throw new Error(
          `Active ReelVersion ${version.id} has no rendered artifact`,
        );
      }

      if (project.client.approvalMode !== "AUTO") {
        const approved = await tx.approval.findFirst({
          where: {
            reelProjectId: project.id,
            reelVersionId: version.id,
            decision: "APPROVED",
          },
          select: { id: true },
        });
        if (!approved) {
          throw new Error(
            `Active ReelVersion ${version.id} requires a version-bound approval before scheduling`,
          );
        }
      }

      const socialAccount = await tx.socialAccount.findUnique({
        where: { id: socialAccountId },
        select: {
          id: true,
          clientId: true,
          platform: true,
          status: true,
          accessTokenCiphertext: true,
          tokenExpiresAt: true,
        },
      });
      if (!socialAccount) {
        throw new Error(`SocialAccount not found: ${socialAccountId}`);
      }

      assertSocialAccountSchedulable(socialAccount, project.client.id);

      const idempotencyKey = buildPublishingIdempotencyKey(
        version.id,
        socialAccountId,
        scheduledAt,
      );

      const existing = await tx.publishingJob.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return {
          job: existing,
          reelVersionId: version.id,
          reused: true,
        };
      }

      if (project.state !== "APPROVED") {
        throw new Error(
          `ReelProject ${project.id} is already scheduled for a different publishing intent`,
        );
      }

      const job = await tx.publishingJob.create({
        data: {
          reelProjectId: project.id,
          reelVersionId: version.id,
          socialAccountId,
          scheduledAt,
          idempotencyKey,
          state: "SCHEDULED",
        },
      });

      const moved = await tx.reelProject.updateMany({
        where: {
          id: project.id,
          state: "APPROVED",
          activeVersion: project.activeVersion,
        },
        data: { state: "SCHEDULED" },
      });
      if (moved.count !== 1) {
        throw new Error(
          `ReelProject ${project.id} changed before scheduling; retry after inspection`,
        );
      }

      await tx.auditEvent.create({
        data: {
          organizationId: project.client.organizationId,
          clientId: project.client.id,
          actorType: "SYSTEM",
          action: "reel.publishing.scheduled",
          entityType: "PublishingJob",
          entityId: job.id,
          metadata: {
            reelProjectId: project.id,
            reelVersionId: version.id,
            socialAccountId,
            scheduledAt: scheduledAt.toISOString(),
            idempotencyKey,
          },
        },
      });

      return {
        job,
        reelVersionId: version.id,
        reused: false,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  // PostgreSQL remains the source of truth. If Redis is unavailable after the DB
  // commit, rerunning this command finds the same PublishingJob and safely retries
  // the deterministic BullMQ enqueue.
  const queueJob = await enqueuePublishingDispatch(
    redisUrl,
    {
      publishingJobId: result.job.id,
      reelProjectId: result.job.reelProjectId,
      reelVersionId: result.reelVersionId,
      socialAccountId: result.job.socialAccountId,
      idempotencyKey: result.job.idempotencyKey,
    },
    result.job.scheduledAt,
  );

  console.log(
    result.reused
      ? "[reel:schedule] durable schedule already exists"
      : "[reel:schedule] reel scheduled",
  );
  console.log(
    JSON.stringify(
      {
        publishingJobId: result.job.id,
        reelProjectId: result.job.reelProjectId,
        reelVersionId: result.reelVersionId,
        socialAccountId: result.job.socialAccountId,
        scheduledAt: result.job.scheduledAt.toISOString(),
        idempotencyKey: result.job.idempotencyKey,
        queueJobId: queueJob.id,
        state: result.job.state,
        reused: result.reused,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error("[reel:schedule] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
