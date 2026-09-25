import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";

loadEnvFile(".env");

const args = process.argv.slice(2);
const clientId = args[0]?.trim();
const title = args[1]?.trim();
const objective = args[2]?.trim();

if (!clientId || !title) {
  console.error(
    'Usage: npm run reel:create -- <client-id> "<title>" ["<objective>"]',
  );
  process.exit(1);
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, status: true },
  });

  if (!client) throw new Error(`Client not found: ${clientId}`);
  if (client.status !== "ACTIVE") {
    throw new Error(`Client ${clientId} is not ACTIVE`);
  }

  const project = await prisma.reelProject.create({
    data: {
      clientId,
      title,
      objective: objective || null,
      state: "DRAFT",
    },
    select: {
      id: true,
      clientId: true,
      title: true,
      objective: true,
      state: true,
      activeVersion: true,
      createdAt: true,
    },
  });

  console.log("[reel:create] reel project created");
  console.log(JSON.stringify({ client: client.name, project }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("[reel:create] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
