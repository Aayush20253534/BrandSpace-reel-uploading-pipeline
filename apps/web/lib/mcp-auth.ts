import { createHash } from "node:crypto";
import { prisma, type MembershipRole } from "@forge/database";

export interface AgentContext {
  credentialId: string;
  userId: string;
  organizationId: string;
  clientId: string | null;
  role: MembershipRole;
  scopes: string[];
}

export class AgentRateLimitError extends Error {
  constructor() {
    super("Agent request rate limit exceeded");
  }
}

export function hashAgentToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function authenticateAgentToken(
  authorization: string | null,
): Promise<AgentContext | null> {
  const match = /^Bearer (bspf_[A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
  const token = match?.[1];
  if (!token) return null;

  const credential = await prisma.agentAccessToken.findUnique({
    where: { tokenHash: hashAgentToken(token) },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      clientId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (
    !credential ||
    credential.revokedAt ||
    credential.expiresAt.getTime() <= Date.now() ||
    !credential.scopes.includes("read")
  ) {
    return null;
  }

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: credential.organizationId,
        userId: credential.userId,
      },
    },
    select: { role: true },
  });
  if (!membership) return null;

  if (credential.clientId) {
    const client = await prisma.client.findFirst({
      where: {
        id: credential.clientId,
        organizationId: credential.organizationId,
      },
      select: { id: true },
    });
    if (!client) return null;
  }

  // The row update is atomic across web instances. A credential receives at
  // most 60 requests in each database-clock minute.
  const admitted = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "AgentAccessToken"
    SET "rateWindowStartedAt" = CASE
          WHEN "rateWindowStartedAt" IS NULL
            OR "rateWindowStartedAt" < date_trunc('minute', CURRENT_TIMESTAMP)
          THEN date_trunc('minute', CURRENT_TIMESTAMP)
          ELSE "rateWindowStartedAt"
        END,
        "rateWindowCount" = CASE
          WHEN "rateWindowStartedAt" IS NULL
            OR "rateWindowStartedAt" < date_trunc('minute', CURRENT_TIMESTAMP)
          THEN 1
          ELSE "rateWindowCount" + 1
        END,
        "lastUsedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${credential.id}
      AND "revokedAt" IS NULL
      AND "expiresAt" > CURRENT_TIMESTAMP
      AND (
        "rateWindowStartedAt" IS NULL
        OR "rateWindowStartedAt" < date_trunc('minute', CURRENT_TIMESTAMP)
        OR "rateWindowCount" < 60
      )
    RETURNING "id"
  `;
  if (admitted.length !== 1) throw new AgentRateLimitError();

  return {
    credentialId: credential.id,
    userId: credential.userId,
    organizationId: credential.organizationId,
    clientId: credential.clientId,
    role: membership.role,
    scopes: credential.scopes,
  };
}
