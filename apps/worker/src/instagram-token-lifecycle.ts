import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { createLogger } from "@forge/logger";
import {
  decryptSocialToken,
  encryptSocialToken,
  InstagramAccountMismatchError,
  InstagramProviderError,
  isInstagramReauthenticationError,
  parseSocialTokenEncryptionKey,
  refreshInstagramLongLivedToken,
  verifyInstagramAccessToken,
} from "@forge/social";

const logger = createLogger("instagram-token-lifecycle");

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const REFRESH_LEAD_MS = 14 * 24 * 60 * 60 * 1_000;
const MIN_REFRESH_AGE_MS = 24 * 60 * 60 * 1_000;
const REFRESH_LEASE_MS = 30 * 60 * 1_000;
const BATCH_SIZE = 100;

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
}

function errorCode(error: unknown) {
  if (error instanceof InstagramAccountMismatchError) {
    return "INSTAGRAM_ACCOUNT_MISMATCH";
  }
  if (error instanceof InstagramProviderError) {
    if (error.providerCode !== null) {
      return `META_${error.providerCode}`;
    }
    return `META_HTTP_${error.httpStatus}`;
  }
  return "INSTAGRAM_TOKEN_REFRESH_FAILED";
}

async function markExpiredAccounts(now: Date) {
  const expired = await prisma.socialAccount.findMany({
    where: {
      platform: "INSTAGRAM",
      status: "CONNECTED",
      tokenExpiresAt: { lte: now },
    },
    select: {
      id: true,
      clientId: true,
      providerAccountId: true,
      username: true,
      client: {
        select: { organizationId: true },
      },
    },
    orderBy: { tokenExpiresAt: "asc" },
    take: BATCH_SIZE,
  });

  let movedToReauth = 0;

  for (const account of expired) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.socialAccount.updateMany({
        where: {
          id: account.id,
          status: "CONNECTED",
          tokenExpiresAt: { lte: now },
        },
        data: {
          status: "NEEDS_REAUTH",
          tokenRefreshLockedAt: null,
          lastAuthErrorCode: "INSTAGRAM_TOKEN_EXPIRED",
          lastAuthErrorMessage:
            "Instagram long-lived token expired before it could be refreshed",
        },
      });

      if (updated.count === 0) return;

      await tx.auditEvent.create({
        data: {
          organizationId: account.client.organizationId,
          clientId: account.clientId,
          actorType: "SYSTEM",
          action: "social.instagram.needs_reauth",
          entityType: "SocialAccount",
          entityId: account.id,
          metadata: {
            reason: "INSTAGRAM_TOKEN_EXPIRED",
            providerAccountId: account.providerAccountId,
            username: account.username,
          },
        },
      });

      movedToReauth += 1;
    });
  }

  return { scanned: expired.length, movedToReauth };
}

async function refreshDueAccounts(now: Date, encryptionKey: string) {
  const refreshBy = new Date(now.getTime() + REFRESH_LEAD_MS);
  const minimumIssuedAt = new Date(now.getTime() - MIN_REFRESH_AGE_MS);
  const staleLeaseBefore = new Date(now.getTime() - REFRESH_LEASE_MS);

  const due = await prisma.socialAccount.findMany({
    where: {
      platform: "INSTAGRAM",
      status: "CONNECTED",
      accessTokenCiphertext: { not: null },
      tokenExpiresAt: {
        gt: now,
        lte: refreshBy,
      },
      tokenIssuedAt: { lte: minimumIssuedAt },
      client: { status: "ACTIVE" },
      OR: [
        { tokenRefreshLockedAt: null },
        { tokenRefreshLockedAt: { lt: staleLeaseBefore } },
      ],
    },
    select: {
      id: true,
      clientId: true,
      providerAccountId: true,
      username: true,
      accessTokenCiphertext: true,
      tokenExpiresAt: true,
      tokenIssuedAt: true,
      tokenRefreshLockedAt: true,
      updatedAt: true,
      client: {
        select: { organizationId: true },
      },
    },
    orderBy: { tokenExpiresAt: "asc" },
    take: BATCH_SIZE,
  });

  let claimed = 0;
  let refreshed = 0;
  let needsReauth = 0;
  let failed = 0;

  for (const account of due) {
    const claimedAt = new Date();
    const claim = await prisma.socialAccount.updateMany({
      where: {
        id: account.id,
        status: "CONNECTED",
        updatedAt: account.updatedAt,
        OR: [
          { tokenRefreshLockedAt: null },
          { tokenRefreshLockedAt: { lt: staleLeaseBefore } },
        ],
      },
      data: {
        tokenRefreshLockedAt: claimedAt,
        lastRefreshAttemptAt: claimedAt,
      },
    });

    if (claim.count !== 1) continue;
    claimed += 1;

    try {
      if (!account.accessTokenCiphertext) {
        throw new Error("Connected Instagram account has no encrypted token");
      }

      const currentToken = decryptSocialToken(
        account.accessTokenCiphertext,
        encryptionKey,
      );
      const refreshedToken = await refreshInstagramLongLivedToken(currentToken);

      const verifiedProfile = await verifyInstagramAccessToken(
        env.META_GRAPH_VERSION,
        refreshedToken.accessToken,
        account.providerAccountId,
      );

      const refreshedAt = new Date();
      const tokenExpiresAt = new Date(
        refreshedAt.getTime() + refreshedToken.expiresInSeconds * 1_000,
      );
      const ciphertext = encryptSocialToken(
        refreshedToken.accessToken,
        encryptionKey,
      );

      await prisma.$transaction(async (tx) => {
        const updated = await tx.socialAccount.updateMany({
          where: {
            id: account.id,
            status: "CONNECTED",
            tokenRefreshLockedAt: claimedAt,
          },
          data: {
            username: verifiedProfile.username,
            displayName: verifiedProfile.displayName,
            accessTokenCiphertext: ciphertext,
            tokenExpiresAt,
            tokenIssuedAt: refreshedAt,
            lastVerifiedAt: refreshedAt,
            lastRefreshedAt: refreshedAt,
            tokenRefreshLockedAt: null,
            lastAuthErrorCode: null,
            lastAuthErrorMessage: null,
          },
        });
        if (updated.count !== 1) {
          throw new Error(
            `Instagram token refresh lease was lost for SocialAccount ${account.id}`,
          );
        }

        await tx.auditEvent.create({
          data: {
            organizationId: account.client.organizationId,
            clientId: account.clientId,
            actorType: "SYSTEM",
            action: "social.instagram.token_refreshed",
            entityType: "SocialAccount",
            entityId: account.id,
            metadata: {
              providerAccountId: account.providerAccountId,
              username: verifiedProfile.username,
              tokenExpiresAt: tokenExpiresAt.toISOString(),
              graphVersion: env.META_GRAPH_VERSION,
            },
          },
        });
      });

      refreshed += 1;
      logger.info("instagram_token_refreshed", {
        socialAccountId: account.id,
        clientId: account.clientId,
        providerAccountId: account.providerAccountId,
        tokenExpiresAt: tokenExpiresAt.toISOString(),
      });
    } catch (error) {
      const message = errorMessage(error);
      const code = errorCode(error);

      if (isInstagramReauthenticationError(error)) {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.socialAccount.updateMany({
            where: {
              id: account.id,
              status: "CONNECTED",
              tokenRefreshLockedAt: claimedAt,
            },
            data: {
              status: "NEEDS_REAUTH",
              tokenRefreshLockedAt: null,
              lastAuthErrorCode: code,
              lastAuthErrorMessage: message,
            },
          });
          if (updated.count === 0) return;

          await tx.auditEvent.create({
            data: {
              organizationId: account.client.organizationId,
              clientId: account.clientId,
              actorType: "SYSTEM",
              action: "social.instagram.needs_reauth",
              entityType: "SocialAccount",
              entityId: account.id,
              metadata: {
                reason: code,
                providerAccountId: account.providerAccountId,
                username: account.username,
              },
            },
          });
        });

        needsReauth += 1;
        logger.warn("instagram_token_needs_reauth", {
          socialAccountId: account.id,
          clientId: account.clientId,
          errorCode: code,
        });
        continue;
      }

      await prisma.socialAccount.updateMany({
        where: {
          id: account.id,
          status: "CONNECTED",
          tokenRefreshLockedAt: claimedAt,
        },
        data: {
          tokenRefreshLockedAt: null,
          lastAuthErrorCode: code,
          lastAuthErrorMessage: message,
        },
      });

      failed += 1;
      logger.error("instagram_token_refresh_failed", {
        socialAccountId: account.id,
        clientId: account.clientId,
        errorCode: code,
        error: message,
      });
    }
  }

  return {
    scanned: due.length,
    claimed,
    refreshed,
    needsReauth,
    failed,
  };
}

export async function maintainInstagramCredentials(now = new Date()) {
  const key = env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    logger.warn("instagram_token_lifecycle_disabled", {
      reason: "SOCIAL_TOKEN_ENCRYPTION_KEY is not configured",
    });
    return {
      expired: { scanned: 0, movedToReauth: 0 },
      refresh: {
        scanned: 0,
        claimed: 0,
        refreshed: 0,
        needsReauth: 0,
        failed: 0,
      },
    };
  }

  parseSocialTokenEncryptionKey(key);

  const expired = await markExpiredAccounts(now);
  const refresh = await refreshDueAccounts(now, key);

  logger.info("instagram_token_maintenance_completed", {
    expiredScanned: expired.scanned,
    expiredMovedToReauth: expired.movedToReauth,
    refreshScanned: refresh.scanned,
    refreshClaimed: refresh.claimed,
    refreshed: refresh.refreshed,
    needsReauth: refresh.needsReauth,
    failed: refresh.failed,
  });

  return { expired, refresh };
}

export function startInstagramTokenLifecycle() {
  let timer: NodeJS.Timeout | null = null;

  const run = () => {
    void maintainInstagramCredentials().catch((error) => {
      logger.error("instagram_token_maintenance_failed", {
        error: errorMessage(error),
      });
    });
  };

  run();
  timer = setInterval(run, REFRESH_INTERVAL_MS);
  timer.unref();

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
