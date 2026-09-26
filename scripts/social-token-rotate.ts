import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { prisma } from "@forge/database";
import {
  decryptSocialTokenFromKeyring,
  encryptSocialToken,
  parseSocialTokenPreviousKeys,
} from "@forge/social";

if (existsSync(".env")) loadEnvFile(".env");

const command = process.argv[2];
if (command !== "dry-run" && command !== "apply") {
  throw new Error("Usage: npm run social:token:rotate -- dry-run|apply");
}

function requireActiveKey() {
  const value = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY is required");
  return value;
}
const activeKey = requireActiveKey();
const previousKeys = parseSocialTokenPreviousKeys(
  process.env.SOCIAL_TOKEN_PREVIOUS_KEYS,
  activeKey,
);
if (previousKeys.length === 0) {
  throw new Error("At least one SOCIAL_TOKEN_PREVIOUS_KEYS value is required");
}

async function rotateAccounts() {
  let cursor: string | null = null;
  let scanned = 0;
  let due = 0;
  let rewrapped = 0;
  for (;;) {
    const batch: Array<{
      id: string;
      clientId: string;
      accessTokenCiphertext: string | null;
      client: { organizationId: string };
    }> = await prisma.socialAccount.findMany({
      where: {
        accessTokenCiphertext: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        clientId: true,
        accessTokenCiphertext: true,
        client: { select: { organizationId: true } },
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (batch.length === 0) break;
    for (const account of batch) {
      cursor = account.id;
      if (!account.accessTokenCiphertext) continue;
      scanned += 1;
      let plaintext: string;
      let keyIndex: number;
      try {
        ({ plaintext, keyIndex } = decryptSocialTokenFromKeyring(
          account.accessTokenCiphertext,
          activeKey,
          previousKeys,
        ));
      } catch {
        throw new Error(`Unable to decrypt SocialAccount ${account.id}`);
      }
      if (keyIndex === 0) continue;
      due += 1;
      if (command === "dry-run") continue;
      const ciphertext = encryptSocialToken(plaintext, activeKey);
      const changed = await prisma.$transaction(async (tx) => {
        const updated = await tx.socialAccount.updateMany({
          where: {
            id: account.id,
            accessTokenCiphertext: account.accessTokenCiphertext,
          },
          data: { accessTokenCiphertext: ciphertext },
        });
        if (updated.count !== 1) return false;
        await tx.auditEvent.create({
          data: {
            organizationId: account.client.organizationId,
            clientId: account.clientId,
            actorType: "SYSTEM",
            action: "social.token.rewrapped",
            entityType: "SocialAccount",
            entityId: account.id,
            metadata: { keyIndex },
          },
        });
        return true;
      });
      if (changed) rewrapped += 1;
    }
  }
  return { scanned, due, rewrapped };
}

async function rotateOAuthAttempts() {
  let cursor: string | null = null;
  let scanned = 0;
  let due = 0;
  let rewrapped = 0;
  for (;;) {
    const batch: Array<{
      id: string;
      clientId: string;
      resultCiphertext: string | null;
      client: { organizationId: string };
    }> = await prisma.socialOAuthAttempt.findMany({
      where: {
        resultCiphertext: { not: null },
        consumedAt: null,
        expiresAt: { gt: new Date() },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        clientId: true,
        resultCiphertext: true,
        client: { select: { organizationId: true } },
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (batch.length === 0) break;
    for (const attempt of batch) {
      cursor = attempt.id;
      if (!attempt.resultCiphertext) continue;
      scanned += 1;
      let plaintext: string;
      let keyIndex: number;
      try {
        ({ plaintext, keyIndex } = decryptSocialTokenFromKeyring(
          attempt.resultCiphertext,
          activeKey,
          previousKeys,
        ));
      } catch {
        throw new Error(`Unable to decrypt SocialOAuthAttempt ${attempt.id}`);
      }
      if (keyIndex === 0) continue;
      due += 1;
      if (command === "dry-run") continue;
      const ciphertext = encryptSocialToken(plaintext, activeKey);
      const changed = await prisma.$transaction(async (tx) => {
        const updated = await tx.socialOAuthAttempt.updateMany({
          where: {
            id: attempt.id,
            consumedAt: null,
            resultCiphertext: attempt.resultCiphertext,
          },
          data: { resultCiphertext: ciphertext },
        });
        if (updated.count !== 1) return false;
        await tx.auditEvent.create({
          data: {
            organizationId: attempt.client.organizationId,
            clientId: attempt.clientId,
            actorType: "SYSTEM",
            action: "social.token.rewrapped",
            entityType: "SocialOAuthAttempt",
            entityId: attempt.id,
            metadata: { keyIndex },
          },
        });
        return true;
      });
      if (changed) rewrapped += 1;
    }
  }
  return { scanned, due, rewrapped };
}

async function main() {
  const accounts = await rotateAccounts();
  const attempts = await rotateOAuthAttempts();
  process.stdout.write(
    JSON.stringify({ mode: command, accounts, attempts }) + "\n",
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write(
      `${message.startsWith("Unable to decrypt ") ? message : "Token rotation failed; inspect trusted service logs"}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
