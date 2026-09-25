import { loadEnvFile } from "node:process";
import { Prisma, prisma } from "../packages/database/src/index.ts";
import {
  nextStateAfterQaPass,
  runTechnicalQa,
  TECHNICAL_QA_VERSION,
} from "../packages/reel-qa/src/index.ts";

loadEnvFile(".env");

const reelVersionId = process.argv[2]?.trim();
if (!reelVersionId) {
  console.error("Usage: npm run reel:qa -- <reel-version-id>");
  process.exit(1);
}

const jsonObject = (
  value: Prisma.JsonValue | null,
): Record<string, Prisma.JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};

const numberValue = (value: Prisma.JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const booleanValue = (value: Prisma.JsonValue | undefined): boolean | null =>
  typeof value === "boolean" ? value : null;

async function main() {
  const version = await prisma.reelVersion.findUnique({
    where: { id: reelVersionId },
    select: {
      id: true,
      reelProjectId: true,
      renderedAssetId: true,
      blueprint: true,
      reelProject: {
        select: {
          state: true,
          client: { select: { approvalMode: true } },
        },
      },
      renderJobs: {
        where: { state: "SUCCEEDED" },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: { id: true, output: true },
      },
    },
  });

  if (!version) throw new Error(`ReelVersion not found: ${reelVersionId}`);

  const existing = await prisma.qaReview.findFirst({
    where: { reelVersionId: version.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, decision: true, technical: true },
  });
  if (existing) {
    console.log("[reel:qa] review already exists");
    console.log(JSON.stringify(existing, null, 2));
    return;
  }

  if (version.reelProject.state !== "QA") {
    throw new Error(
      `ReelProject ${version.reelProjectId} must be QA before technical review`,
    );
  }
  if (!version.renderedAssetId) {
    throw new Error(`ReelVersion ${version.id} does not have a rendered asset`);
  }

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: version.renderedAssetId },
    select: {
      id: true,
      kind: true,
      state: true,
      mimeType: true,
      sizeBytes: true,
      durationMs: true,
      width: true,
      height: true,
      driveFileId: true,
    },
  });
  if (!asset)
    throw new Error(`Rendered asset not found: ${version.renderedAssetId}`);
  if (asset.kind !== "GENERATED_REEL" || asset.state !== "READY") {
    throw new Error(`Rendered asset ${asset.id} is not a READY GENERATED_REEL`);
  }

  const blueprint = jsonObject(version.blueprint);
  const expectedDurationMs = numberValue(blueprint.targetDurationMs);
  if (
    expectedDurationMs === null ||
    !Number.isInteger(expectedDurationMs) ||
    expectedDurationMs <= 0
  ) {
    throw new Error("Reel blueprint has an invalid targetDurationMs");
  }

  const latestRender = version.renderJobs[0];
  if (!latestRender) {
    throw new Error(`ReelVersion ${version.id} has no successful RenderJob`);
  }
  const renderOutput = jsonObject(latestRender.output);

  const result = runTechnicalQa({
    expectedDurationMs,
    actualDurationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    hasVideo: booleanValue(renderOutput.hasVideo),
    hasAudio: booleanValue(renderOutput.hasAudio),
  });

  const decision = result.pass ? "PASS" : "FAIL";
  const nextState = result.pass
    ? nextStateAfterQaPass(version.reelProject.client.approvalMode)
    : "QA";

  const persisted = await prisma.$transaction(
    async (tx) => {
      const current = await tx.reelProject.findUnique({
        where: { id: version.reelProjectId },
        select: { state: true },
      });
      if (!current || current.state !== "QA") {
        throw new Error(
          `ReelProject ${version.reelProjectId} changed state during QA`,
        );
      }

      const review = await tx.qaReview.create({
        data: {
          reelVersionId: version.id,
          decision,
          summary: result.pass
            ? "Technical QA passed"
            : "Technical QA failed; inspect failed checks before re-rendering",
          technical: {
            ...result,
            renderedAssetId: asset.id,
            driveFileId: asset.driveFileId,
            renderJobId: latestRender.id,
          },
        },
        select: { id: true, decision: true },
      });

      if (result.pass) {
        await tx.reelProject.update({
          where: { id: version.reelProjectId },
          data: { state: nextState },
        });
      }

      return review;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  console.log("[reel:qa] technical review complete");
  console.log(
    JSON.stringify(
      {
        qaReviewId: persisted.id,
        reelVersionId: version.id,
        reelProjectId: version.reelProjectId,
        decision: persisted.decision,
        technicalQaVersion: TECHNICAL_QA_VERSION,
        checks: result.checks,
        nextState,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error("[reel:qa] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
