import { loadEnvFile } from "node:process";
import { Prisma, prisma } from "../packages/database/src/index.ts";
import {
  CREATIVE_QA_VERSION,
  runCreativeQa,
} from "../packages/reel-qa/src/index.ts";

loadEnvFile(".env");

const reelVersionId = process.argv[2]?.trim();
if (!reelVersionId) {
  console.error("Usage: npm run reel:qa:creative -- <reel-version-id>");
  process.exit(1);
}

type JsonRecord = Record<string, Prisma.JsonValue>;

const jsonObject = (value: Prisma.JsonValue | null): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const stringValue = (value: Prisma.JsonValue | undefined): string | null =>
  typeof value === "string" ? value : null;

const clipPurposes = (value: Prisma.JsonValue | undefined): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record =
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? (item as JsonRecord)
        : null;
    const purpose = record ? stringValue(record.purpose) : null;
    return purpose === null ? [] : [purpose];
  });
};

async function main() {
  const version = await prisma.reelVersion.findUnique({
    where: { id: reelVersionId },
    select: {
      id: true,
      reelProjectId: true,
      blueprint: true,
      caption: true,
      cta: true,
      reelProject: {
        select: {
          state: true,
          client: {
            select: {
              brandProfile: {
                select: {
                  bannedWords: true,
                  forbiddenTopics: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!version) throw new Error(`ReelVersion not found: ${reelVersionId}`);

  const review = await prisma.qaReview.findFirst({
    where: { reelVersionId: version.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      decision: true,
      technical: true,
      creative: true,
      summary: true,
    },
  });
  if (!review) {
    throw new Error(
      `ReelVersion ${version.id} must complete technical QA before creative QA`,
    );
  }
  if (review.decision !== "PASS") {
    throw new Error(
      `QaReview ${review.id} must pass technical QA before creative QA`,
    );
  }
  if (review.creative !== null) {
    console.log("[reel:qa:creative] review already exists");
    console.log(
      JSON.stringify({ id: review.id, creative: review.creative }, null, 2),
    );
    return;
  }

  if (
    version.reelProject.state !== "AWAITING_APPROVAL" &&
    version.reelProject.state !== "APPROVED"
  ) {
    throw new Error(
      `ReelProject ${version.reelProjectId} cannot run creative QA from ${version.reelProject.state}`,
    );
  }

  const blueprint = jsonObject(version.blueprint);
  const brand = version.reelProject.client.brandProfile;
  const result = runCreativeQa({
    hook: stringValue(blueprint.hook),
    caption: version.caption,
    cta: version.cta,
    clipPurposes: clipPurposes(blueprint.clips),
    bannedWords: brand?.bannedWords ?? [],
    forbiddenTopics: brand?.forbiddenTopics ?? [],
  });

  const updated = await prisma.qaReview.updateMany({
    where: {
      id: review.id,
      creative: { equals: Prisma.DbNull },
    },
    data: {
      creative: result,
      decision: result.pass ? "PASS" : "NEEDS_REVISION",
      summary: result.pass
        ? "Technical and deterministic creative QA passed"
        : "Creative QA found brand-policy issues; revision is required",
    },
  });

  if (updated.count !== 1) {
    const current = await prisma.qaReview.findUnique({
      where: { id: review.id },
      select: { creative: true },
    });
    console.log("[reel:qa:creative] review already exists");
    console.log(
      JSON.stringify({ id: review.id, creative: current?.creative }, null, 2),
    );
    return;
  }

  if (!result.pass) {
    await prisma.reelProject.updateMany({
      where: {
        id: version.reelProjectId,
        state: "AWAITING_APPROVAL",
      },
      data: { state: "REVISION_REQUESTED" },
    });
  }

  console.log("[reel:qa:creative] review complete");
  console.log(
    JSON.stringify(
      {
        qaReviewId: review.id,
        reelVersionId: version.id,
        reelProjectId: version.reelProjectId,
        decision: result.pass ? "PASS" : "NEEDS_REVISION",
        creativeQaVersion: CREATIVE_QA_VERSION,
        checks: result.checks,
        nextState: result.pass
          ? version.reelProject.state
          : version.reelProject.state === "AWAITING_APPROVAL"
            ? "REVISION_REQUESTED"
            : version.reelProject.state,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error("[reel:qa:creative] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
