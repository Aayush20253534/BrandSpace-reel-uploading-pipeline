import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";

loadEnvFile(".env");

const reelProjectId = process.argv[2]?.trim();
if (!reelProjectId) {
  console.error("Usage: npm run reel:inspect -- <reel-project-id>");
  process.exit(1);
}

async function main() {
  const project = await prisma.reelProject.findUnique({
    where: { id: reelProjectId },
    select: {
      id: true,
      clientId: true,
      title: true,
      objective: true,
      state: true,
      activeVersion: true,
      versions: {
        orderBy: { version: "asc" },
        select: {
          id: true,
          version: true,
          blueprint: true,
          caption: true,
          cta: true,
          createdByActorType: true,
          createdAt: true,
          sources: {
            orderBy: { order: "asc" },
            select: {
              order: true,
              mediaAssetId: true,
              inMs: true,
              outMs: true,
              role: true,
            },
          },
        },
      },
    },
  });

  if (!project) throw new Error(`ReelProject not found: ${reelProjectId}`);

  const [provenance, usage] = await Promise.all([
    prisma.aiProvenance.findMany({
      where: { reelProjectId },
      orderBy: { createdAt: "asc" },
      select: {
        operation: true,
        provider: true,
        model: true,
        promptVersion: true,
        inputReference: true,
        structuredOutput: true,
        confidence: true,
        latencyMs: true,
        createdAt: true,
      },
    }),
    prisma.usageLedger.findMany({
      where: { reelProjectId },
      orderBy: { occurredAt: "asc" },
      select: {
        kind: true,
        operation: true,
        provider: true,
        model: true,
        inputUnits: true,
        outputUnits: true,
        costUsd: true,
        metadata: true,
        occurredAt: true,
      },
    }),
  ]);

  console.log("[reel:inspect] persisted planning state");
  console.log(
    JSON.stringify(
      {
        project,
        provenance,
        usage,
      },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error("[reel:inspect] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
