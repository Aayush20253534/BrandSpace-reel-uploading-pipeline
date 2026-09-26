import { NextResponse, type NextRequest } from "next/server";
import { env } from "@forge/config";
import { Prisma, prisma } from "@forge/database";
import {
  completeInstagramOAuth,
  decryptSocialToken,
  encryptSocialToken,
  hashInstagramOAuthState,
  parseSocialTokenEncryptionKey,
  type InstagramOAuthResult,
} from "@forge/social";
import { requireRole, requireSession } from "../../../../../lib/auth-session";

const CONNECTION_ROLES = ["OWNER", "ADMIN"] as const;

function providerError(request: NextRequest) {
  return Boolean(request.nextUrl.searchParams.get("error")?.trim());
}

function readStagedResult(ciphertext: string, key: string) {
  const value: unknown = JSON.parse(decryptSocialToken(ciphertext, key));
  if (!value || typeof value !== "object") {
    throw new Error("Invalid staged Instagram OAuth result");
  }
  const result = value as Partial<InstagramOAuthResult>;
  if (
    typeof result.accessToken !== "string" ||
    !result.accessToken ||
    typeof result.authorizationUserId !== "string" ||
    typeof result.providerAccountId !== "string" ||
    typeof result.username !== "string" ||
    !Array.isArray(result.scopes) ||
    !result.scopes.every((scope) => typeof scope === "string") ||
    typeof result.expiresInSeconds !== "number" ||
    result.expiresInSeconds <= 0
  ) {
    throw new Error("Invalid staged Instagram OAuth result");
  }
  return result as InstagramOAuthResult;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const state = request.nextUrl.searchParams.get("state")?.trim();
    if (!state) {
      return NextResponse.json(
        { error: "Missing Instagram OAuth state" },
        { status: 400 },
      );
    }

    const attempt = await prisma.socialOAuthAttempt.findUnique({
      where: { stateHash: hashInstagramOAuthState(state) },
      select: {
        id: true,
        clientId: true,
        userId: true,
        provider: true,
        redirectUri: true,
        expiresAt: true,
        consumedAt: true,
        resultCiphertext: true,
        resultRecordedAt: true,
        client: {
          select: {
            id: true,
            status: true,
            organizationId: true,
          },
        },
      },
    });

    if (
      !attempt ||
      attempt.provider !== "INSTAGRAM" ||
      attempt.userId !== session.user.id ||
      attempt.consumedAt ||
      attempt.expiresAt.getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: "Invalid or expired Instagram OAuth state" },
        { status: 400 },
      );
    }
    if (attempt.client.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Client must be ACTIVE" },
        { status: 409 },
      );
    }

    await requireRole(attempt.client.organizationId, CONNECTION_ROLES);

    if (providerError(request)) {
      return NextResponse.json(
        { error: "Instagram authorization was not completed" },
        { status: 400 },
      );
    }

    const code = request.nextUrl.searchParams.get("code")?.trim();
    if (!code && !attempt.resultCiphertext) {
      return NextResponse.json(
        { error: "Missing Instagram authorization code" },
        { status: 400 },
      );
    }

    if (
      !attempt.resultCiphertext &&
      (!env.META_APP_ID || !env.META_APP_SECRET)
    ) {
      return NextResponse.json(
        { error: "Meta Instagram application credentials are not configured" },
        { status: 503 },
      );
    }
    if (!env.SOCIAL_TOKEN_ENCRYPTION_KEY) {
      return NextResponse.json(
        { error: "SOCIAL_TOKEN_ENCRYPTION_KEY is not configured" },
        { status: 503 },
      );
    }
    parseSocialTokenEncryptionKey(env.SOCIAL_TOKEN_ENCRYPTION_KEY);

    let oauth: InstagramOAuthResult;
    let resultRecordedAt: Date;
    if (attempt.resultCiphertext && attempt.resultRecordedAt) {
      oauth = readStagedResult(
        attempt.resultCiphertext,
        env.SOCIAL_TOKEN_ENCRYPTION_KEY,
      );
      resultRecordedAt = attempt.resultRecordedAt;
    } else {
      oauth = await completeInstagramOAuth(
        {
          appId: env.META_APP_ID!,
          appSecret: env.META_APP_SECRET!,
          redirectUri: attempt.redirectUri,
          graphVersion: env.META_GRAPH_VERSION,
        },
        code!,
      );
      resultRecordedAt = new Date();
      const staged = await prisma.socialOAuthAttempt.updateMany({
        where: {
          id: attempt.id,
          consumedAt: null,
          expiresAt: { gt: resultRecordedAt },
          resultCiphertext: null,
        },
        data: {
          resultCiphertext: encryptSocialToken(
            JSON.stringify(oauth),
            env.SOCIAL_TOKEN_ENCRYPTION_KEY,
          ),
          resultRecordedAt,
        },
      });
      if (staged.count !== 1) {
        throw new Error("INSTAGRAM_OAUTH_STATE_CONSUMED");
      }
    }

    const ciphertext = encryptSocialToken(
      oauth.accessToken,
      env.SOCIAL_TOKEN_ENCRYPTION_KEY,
    );
    const tokenExpiresAt = new Date(
      resultRecordedAt.getTime() + oauth.expiresInSeconds * 1_000,
    );
    const now = new Date();

    const account = await prisma.$transaction(
      async (tx) => {
        const consumed = await tx.socialOAuthAttempt.updateMany({
          where: {
            id: attempt.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: {
            consumedAt: new Date(),
            resultCiphertext: null,
            resultRecordedAt: null,
          },
        });
        if (consumed.count !== 1) {
          throw new Error("INSTAGRAM_OAUTH_STATE_CONSUMED");
        }

        const assignedElsewhere = await tx.socialAccount.findFirst({
          where: {
            platform: "INSTAGRAM",
            providerAccountId: oauth.providerAccountId,
            clientId: { not: attempt.clientId },
            status: { in: ["CONNECTED", "NEEDS_REAUTH"] },
          },
          select: { id: true, clientId: true },
        });
        if (assignedElsewhere) {
          throw new Error("INSTAGRAM_ACCOUNT_ALREADY_ASSIGNED");
        }

        const saved = await tx.socialAccount.upsert({
          where: {
            clientId_platform_providerAccountId: {
              clientId: attempt.clientId,
              platform: "INSTAGRAM",
              providerAccountId: oauth.providerAccountId,
            },
          },
          create: {
            clientId: attempt.clientId,
            platform: "INSTAGRAM",
            providerAccountId: oauth.providerAccountId,
            username: oauth.username,
            displayName: oauth.displayName,
            status: "CONNECTED",
            scopes: oauth.scopes,
            accessTokenCiphertext: ciphertext,
            tokenExpiresAt,
            tokenIssuedAt: now,
            connectedAt: now,
            lastVerifiedAt: now,
            lastRefreshAttemptAt: null,
            lastRefreshedAt: null,
            tokenRefreshLockedAt: null,
            lastAuthErrorCode: null,
            lastAuthErrorMessage: null,
            metadata: {
              authMode: "instagram_login",
              graphVersion: env.META_GRAPH_VERSION,
              tokenType: oauth.tokenType,
              authorizationUserId: oauth.authorizationUserId,
              connectedByUserId: session.user.id,
            },
          },
          update: {
            username: oauth.username,
            displayName: oauth.displayName,
            status: "CONNECTED",
            scopes: oauth.scopes,
            accessTokenCiphertext: ciphertext,
            tokenExpiresAt,
            tokenIssuedAt: now,
            connectedAt: now,
            lastVerifiedAt: now,
            lastRefreshAttemptAt: null,
            lastRefreshedAt: null,
            tokenRefreshLockedAt: null,
            lastAuthErrorCode: null,
            lastAuthErrorMessage: null,
            metadata: {
              authMode: "instagram_login",
              graphVersion: env.META_GRAPH_VERSION,
              tokenType: oauth.tokenType,
              authorizationUserId: oauth.authorizationUserId,
              connectedByUserId: session.user.id,
            },
          },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: attempt.client.organizationId,
            clientId: attempt.clientId,
            actorType: "USER",
            actorId: session.user.id,
            action: "social.instagram.connected",
            entityType: "SocialAccount",
            entityId: saved.id,
            metadata: {
              providerAccountId: saved.providerAccountId,
              username: saved.username,
              scopes: saved.scopes,
              tokenExpiresAt: saved.tokenExpiresAt?.toISOString() ?? null,
              graphVersion: env.META_GRAPH_VERSION,
            },
          },
        });

        return saved;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    return NextResponse.json(
      {
        connected: true,
        account: {
          id: account.id,
          clientId: account.clientId,
          platform: account.platform,
          providerAccountId: account.providerAccountId,
          username: account.username,
          displayName: account.displayName,
          status: account.status,
          scopes: account.scopes,
          tokenExpiresAt: account.tokenExpiresAt,
          lastVerifiedAt: account.lastVerifiedAt,
        },
      },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message === "INSTAGRAM_ACCOUNT_ALREADY_ASSIGNED") {
      return NextResponse.json(
        {
          error:
            "This Instagram account is already connected to another client",
        },
        { status: 409 },
      );
    }
    if (message === "INSTAGRAM_OAUTH_STATE_CONSUMED") {
      return NextResponse.json(
        { error: "Instagram OAuth state has already been consumed" },
        { status: 409 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "This Instagram account is already connected" },
        { status: 409 },
      );
    }

    console.error("[instagram:oauth:callback] failed", {
      type: error instanceof Error ? error.name : "UnknownError",
      code:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : null,
    });
    return NextResponse.json(
      { error: "Instagram account connection failed" },
      { status: 502 },
    );
  }
}
