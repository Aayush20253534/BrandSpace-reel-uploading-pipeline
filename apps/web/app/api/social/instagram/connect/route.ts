import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@forge/config";
import { prisma } from "@forge/database";
import {
  buildInstagramAuthorizationUrl,
  hashInstagramOAuthState,
} from "@forge/social";
import { requireRole } from "../../../../../lib/auth-session";

const OAUTH_TTL_MS = 10 * 60 * 1_000;
const CONNECTION_ROLES = ["OWNER", "ADMIN"] as const;

function redirectUri() {
  return (
    env.META_INSTAGRAM_REDIRECT_URI ??
    new URL("/api/social/instagram/callback", env.APP_URL).toString()
  );
}

export async function GET(request: NextRequest) {
  try {
    if (!env.META_APP_ID) {
      return NextResponse.json(
        { error: "META_APP_ID is not configured" },
        { status: 503 },
      );
    }

    const clientId = request.nextUrl.searchParams.get("clientId")?.trim();
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 },
      );
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        status: true,
        organizationId: true,
      },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Client must be ACTIVE" },
        { status: 409 },
      );
    }

    const { session } = await requireRole(
      client.organizationId,
      CONNECTION_ROLES,
    );

    const state = randomBytes(32).toString("base64url");
    const stateHash = hashInstagramOAuthState(state);
    const oauthRedirectUri = redirectUri();
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.socialOAuthAttempt.deleteMany({
        where: {
          userId: session.user.id,
          provider: "INSTAGRAM",
          expiresAt: { lt: now },
        },
      });

      await tx.socialOAuthAttempt.create({
        data: {
          clientId: client.id,
          userId: session.user.id,
          provider: "INSTAGRAM",
          stateHash,
          redirectUri: oauthRedirectUri,
          expiresAt: new Date(now.getTime() + OAUTH_TTL_MS),
        },
      });
    });

    const authorizationUrl = buildInstagramAuthorizationUrl(
      {
        appId: env.META_APP_ID,
        redirectUri: oauthRedirectUri,
      },
      state,
    );

    return NextResponse.redirect(authorizationUrl, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    console.error("[instagram:oauth:start] failed", error);
    return NextResponse.json(
      { error: "Unable to start Instagram authorization" },
      { status: 500 },
    );
  }
}
