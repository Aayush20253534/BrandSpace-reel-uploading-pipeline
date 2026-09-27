import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { prisma } from "@forge/database";

if (existsSync(".env")) loadEnvFile(".env");

async function main() {
  const [action, collectionId, actorId] = process.argv.slice(2);
  if (!collectionId || !["status", "retry"].includes(action ?? "")) {
    throw new Error(
      "Usage: npm run instagram:insights:reconcile -- status <collection-id> | retry <collection-id> <owner-or-admin-user-id>",
    );
  }
  const collection = await prisma.analyticsCollection.findUnique({
    where: { id: collectionId },
    select: {
      id: true,
      state: true,
      nextCaptureAt: true,
      captureStartedAt: true,
      attemptCount: true,
      capturedCount: true,
      lastErrorCode: true,
      publishingJob: {
        select: {
          reelProject: {
            select: {
              clientId: true,
              client: { select: { organizationId: true } },
            },
          },
          socialAccount: { select: { clientId: true, status: true } },
        },
      },
    },
  });
  if (!collection) throw new Error("Analytics collection unavailable");
  if (action === "status") {
    process.stdout.write(
      JSON.stringify({
        id: collection.id,
        state: collection.state,
        nextCaptureAt: collection.nextCaptureAt,
        captureStartedAt: collection.captureStartedAt,
        attemptCount: collection.attemptCount,
        capturedCount: collection.capturedCount,
        lastErrorCode: collection.lastErrorCode,
      }) + "\n",
    );
    return;
  }
  if (!actorId) throw new Error("Owner or admin user ID required");
  const clientId = collection.publishingJob.reelProject.clientId;
  const organizationId =
    collection.publishingJob.reelProject.client.organizationId;
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: actorId } },
    select: { role: true },
  });
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    throw new Error("Owner or admin membership required");
  }
  if (
    collection.state !== "NEEDS_ATTENTION" ||
    collection.publishingJob.socialAccount.clientId !== clientId ||
    collection.publishingJob.socialAccount.status !== "CONNECTED"
  ) {
    throw new Error("Collection is not ready for a safe retry");
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.analyticsCollection.updateMany({
      where: { id: collection.id, state: "NEEDS_ATTENTION" },
      data: {
        state: "RETRY_WAIT",
        nextCaptureAt: new Date(),
        attemptCount: 0,
        lockedAt: null,
        lastErrorCode: null,
      },
    });
    if (updated.count !== 1) throw new Error("Collection changed during retry");
    await tx.auditEvent.create({
      data: {
        organizationId,
        clientId,
        actorType: "USER",
        actorId,
        action: "analytics.collection.retry_requested",
        entityType: "AnalyticsCollection",
        entityId: collection.id,
      },
    });
  });
  process.stdout.write(
    JSON.stringify({ id: collection.id, state: "RETRY_WAIT" }) + "\n",
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Reconciliation failed"}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
