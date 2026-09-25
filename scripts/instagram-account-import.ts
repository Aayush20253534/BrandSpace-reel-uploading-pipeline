import { loadEnvFile } from "node:process";
import { Prisma, prisma } from "../packages/database/src/index.ts";
import {
  encryptSocialToken,
  INSTAGRAM_PUBLISHING_SCOPES,
  parseSocialTokenEncryptionKey,
} from "../packages/social/src/index.ts";

loadEnvFile(".env");

const clientId = process.argv[2]?.trim();
const providerAccountId = process.argv[3]?.trim();
const username = process.argv[4]?.trim();
const expiresAtRaw = process.argv[5]?.trim();

if (!clientId || !providerAccountId || !username) {
  console.error(
    "Usage: npm run instagram:account:import -- <client-id> <instagram-user-id> <username> [expires-at-iso]",
  );
  console.error(
    "Set INSTAGRAM_ACCESS_TOKEN in the current process; never pass it as a CLI argument.",
  );
  process.exit(1);
}

const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
if (!accessToken) {
  throw new Error("INSTAGRAM_ACCESS_TOKEN is required in the current process");
}

const encryptionKey = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY?.trim();
if (!encryptionKey) {
  throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY is required");
}
parseSocialTokenEncryptionKey(encryptionKey);

const tokenExpiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
if (tokenExpiresAt && Number.isNaN(tokenExpiresAt.getTime())) {
  throw new Error(`Invalid token expiry timestamp: ${expiresAtRaw}`);
}

async function main() {
  const ciphertext = encryptSocialToken(accessToken, encryptionKey);

  const result = await prisma.$transaction(
    async (tx) => {
      const client = await tx.client.findUnique({
        where: { id: clientId },
        select: {
          id: true,
          status: true,
          organizationId: true,
        },
      });

      if (!client) {
        throw new Error(`Client not found: ${clientId}`);
      }
      if (client.status !== "ACTIVE") {
        throw new Error(`Client ${client.id} must be ACTIVE`);
      }

      const account = await tx.socialAccount.upsert({
        where: {
          clientId_platform_providerAccountId: {
            clientId: client.id,
            platform: "INSTAGRAM",
            providerAccountId,
          },
        },
        create: {
          clientId: client.id,
          platform: "INSTAGRAM",
          providerAccountId,
          username,
          status: "PENDING",
          scopes: [...INSTAGRAM_PUBLISHING_SCOPES],
          accessTokenCiphertext: ciphertext,
          tokenExpiresAt,
          metadata: {
            importSource: "operator-cli",
            requiresMetaVerification: true,
          },
        },
        update: {
          username,
          status: "PENDING",
          scopes: [...INSTAGRAM_PUBLISHING_SCOPES],
          accessTokenCiphertext: ciphertext,
          tokenExpiresAt,
          connectedAt: null,
          lastVerifiedAt: null,
          metadata: {
            importSource: "operator-cli",
            requiresMetaVerification: true,
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorType: "SYSTEM",
          action: "social.instagram.credential_imported",
          entityType: "SocialAccount",
          entityId: account.id,
          metadata: {
            providerAccountId,
            username,
            status: account.status,
            scopes: account.scopes,
            tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
          },
        },
      });

      return account;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  console.log("[instagram:account:import] credential stored for verification");
  console.log(
    JSON.stringify(
      {
        id: result.id,
        clientId: result.clientId,
        platform: result.platform,
        providerAccountId: result.providerAccountId,
        username: result.username,
        status: result.status,
        scopes: result.scopes,
        tokenExpiresAt: result.tokenExpiresAt?.toISOString() ?? null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error("[instagram:account:import] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
