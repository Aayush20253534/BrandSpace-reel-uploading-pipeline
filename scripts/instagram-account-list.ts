import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";

loadEnvFile(".env");

const clientId = process.argv[2]?.trim();

if (!clientId) {
  console.error("Usage: npm run instagram:account:list -- <client-id>");
  process.exit(1);
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      socialAccounts: {
        orderBy: [
          { platform: "asc" },
          { username: "asc" },
          { createdAt: "asc" },
        ],
        select: {
          id: true,
          platform: true,
          providerAccountId: true,
          username: true,
          displayName: true,
          status: true,
          scopes: true,
          tokenExpiresAt: true,
          tokenIssuedAt: true,
          connectedAt: true,
          lastVerifiedAt: true,
          lastRefreshAttemptAt: true,
          lastRefreshedAt: true,
          tokenRefreshLockedAt: true,
          lastAuthErrorCode: true,
          lastAuthErrorMessage: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  console.log(
    JSON.stringify(
      {
        clientId: client.id,
        clientName: client.name,
        accounts: client.socialAccounts,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error("[instagram:account:list] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
