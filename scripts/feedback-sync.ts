import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Prisma, prisma } from "@forge/database";
import {
  extractReelFeatures,
  REEL_FEEDBACK_SCHEMA_VERSION,
} from "@forge/domain/feedback";

if (existsSync(".env")) loadEnvFile(".env");

function requireClientId() {
  const value = process.argv[2]?.trim();
  if (!value) throw new Error("Usage: npm run feedback:sync -- <client-id>");
  return value;
}
const clientId = requireClientId();
const BATCH_SIZE = 100;

const versionSelect = {
  id: true,
  blueprint: true,
  createdAt: true,
  sources: {
    select: {
      mediaAssetId: true,
      order: true,
      role: true,
      inMs: true,
      outMs: true,
      mediaAsset: { select: { clientId: true } },
    },
  },
  reelProject: { select: { objective: true, campaignKey: true } },
} as const satisfies Prisma.ReelVersionSelect;
type VersionRow = Prisma.ReelVersionGetPayload<{
  select: typeof versionSelect;
}>;

const snapshotSelect = {
  id: true,
  capturedAt: true,
  metrics: true,
  publishingJob: {
    select: {
      id: true,
      reelProjectId: true,
      state: true,
      scheduledAt: true,
      publishedAt: true,
      reelVersion: {
        select: {
          id: true,
          reelProjectId: true,
          blueprint: true,
          sources: {
            select: {
              mediaAssetId: true,
              order: true,
              role: true,
              inMs: true,
              outMs: true,
              mediaAsset: { select: { clientId: true } },
            },
          },
          reelProject: {
            select: { clientId: true, objective: true, campaignKey: true },
          },
        },
      },
    },
  },
} as const satisfies Prisma.ReelAnalyticsSnapshotSelect;
type SnapshotRow = Prisma.ReelAnalyticsSnapshotGetPayload<{
  select: typeof snapshotSelect;
}>;

async function storeBatch(
  organizationId: string,
  phase: "version" | "snapshot",
  data: Prisma.ReelFeedbackObservationCreateManyInput[],
) {
  if (data.length === 0) return 0;
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.reelFeedbackObservation.createMany({
      data,
      skipDuplicates: true,
    });
    if (inserted.count > 0) {
      await tx.auditEvent.create({
        data: {
          organizationId,
          clientId,
          actorType: "SYSTEM",
          action: "reel.feedback.synced",
          entityType: "Client",
          entityId: clientId,
          metadata: {
            phase,
            schemaVersion: REEL_FEEDBACK_SCHEMA_VERSION,
            inserted: inserted.count,
          },
        },
      });
    }
    return inserted.count;
  });
}

async function syncVersions(organizationId: string, timezone: string) {
  let cursor: string | null = null;
  let scanned = 0;
  let inserted = 0;
  for (;;) {
    const batch: VersionRow[] = await prisma.reelVersion.findMany({
      where: {
        reelProject: { clientId },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: versionSelect,
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;
    const data: Prisma.ReelFeedbackObservationCreateManyInput[] = batch.map(
      (version) => {
        if (
          version.sources.some(
            (source) => source.mediaAsset.clientId !== clientId,
          )
        ) {
          throw new Error("Cross-client source asset cannot enter feedback");
        }
        return {
          clientId,
          reelVersionId: version.id,
          sourceKey: `${REEL_FEEDBACK_SCHEMA_VERSION}:version:${version.id}`,
          schemaVersion: REEL_FEEDBACK_SCHEMA_VERSION,
          features: extractReelFeatures({
            blueprint: version.blueprint,
            sources: version.sources,
            objective: version.reelProject.objective,
            campaignKey: version.reelProject.campaignKey,
            timezone,
          }),
          observedAt: version.createdAt,
        };
      },
    );
    scanned += batch.length;
    inserted += await storeBatch(organizationId, "version", data);
    cursor = batch.at(-1)?.id ?? null;
  }
  return { scanned, inserted };
}

async function syncSnapshots(organizationId: string, timezone: string) {
  let cursor: string | null = null;
  let scanned = 0;
  let inserted = 0;
  for (;;) {
    const batch: SnapshotRow[] = await prisma.reelAnalyticsSnapshot.findMany({
      where: {
        publishingJob: { reelProject: { clientId } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: snapshotSelect,
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;
    const data: Prisma.ReelFeedbackObservationCreateManyInput[] = batch.map(
      (snapshot) => {
        const job = snapshot.publishingJob;
        const version = job.reelVersion;
        if (
          version.reelProjectId !== job.reelProjectId ||
          version.reelProject.clientId !== clientId ||
          version.sources.some(
            (source) => source.mediaAsset.clientId !== clientId,
          )
        ) {
          throw new Error(
            "Cross-project analytics snapshot cannot enter feedback",
          );
        }
        return {
          clientId,
          reelVersionId: version.id,
          publishingJobId: job.id,
          analyticsSnapshotId: snapshot.id,
          sourceKey: `${REEL_FEEDBACK_SCHEMA_VERSION}:snapshot:${snapshot.id}`,
          schemaVersion: REEL_FEEDBACK_SCHEMA_VERSION,
          features: extractReelFeatures({
            blueprint: version.blueprint,
            sources: version.sources,
            objective: version.reelProject.objective,
            campaignKey: version.reelProject.campaignKey,
            timezone,
            publishingJob: job,
          }),
          providerMetrics:
            snapshot.metrics === null
              ? Prisma.JsonNull
              : (snapshot.metrics as Prisma.InputJsonValue),
          observedAt: snapshot.capturedAt,
        };
      },
    );
    scanned += batch.length;
    inserted += await storeBatch(organizationId, "snapshot", data);
    cursor = batch.at(-1)?.id ?? null;
  }
  return { scanned, inserted };
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, organizationId: true, timezone: true },
  });
  if (!client) throw new Error("Client unavailable");
  const versions = await syncVersions(client.organizationId, client.timezone);
  const snapshots = await syncSnapshots(client.organizationId, client.timezone);
  process.stdout.write(
    JSON.stringify({ clientId, versions, snapshots }) + "\n",
  );
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Feedback sync failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
