import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { prisma } from "@forge/database";

if (existsSync(".env")) loadEnvFile(".env");

function usage(): never {
  throw new Error(
    "Usage: npm run agent:token -- create <organization-id> <actor-user-id> <target-user-id> <client-id|all> <label> | revoke <credential-id> <actor-user-id>",
  );
}

async function requireAdministrator(
  organizationId: string,
  actorUserId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: actorUserId } },
    select: { role: true },
  });
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    throw new Error("Actor must be an organization owner or admin");
  }
}

async function createCredential(args: string[]) {
  const [organizationId, actorUserId, targetUserId, clientArgument, label] =
    args;
  if (
    !organizationId ||
    !actorUserId ||
    !targetUserId ||
    !clientArgument ||
    !label
  )
    usage();
  if (label.trim().length < 3 || label.trim().length > 80) {
    throw new Error("Credential label must be 3–80 characters");
  }
  await requireAdministrator(organizationId, actorUserId);
  const target = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
    select: { userId: true },
  });
  if (!target)
    throw new Error("Target user is not a member of this organization");

  const clientId = clientArgument === "all" ? null : clientArgument;
  if (clientId) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true },
    });
    if (!client) throw new Error("Client is outside this organization");
  }

  const token = `bspf_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);
  const credential = await prisma.$transaction(async (tx) => {
    const created = await tx.agentAccessToken.create({
      data: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
        userId: targetUserId,
        organizationId,
        clientId,
        label: label.trim(),
        scopes: ["read"],
        expiresAt,
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        organizationId,
        clientId,
        actorType: "USER",
        actorId: actorUserId,
        action: "agent.credential.created",
        entityType: "AgentAccessToken",
        entityId: created.id,
        metadata: {
          targetUserId,
          label: label.trim(),
          scopes: ["read"],
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
    return created;
  });
  process.stdout.write(
    `Credential ID: ${credential.id}\nExpires: ${expiresAt.toISOString()}\nBearer token (shown once): ${token}\n`,
  );
}

async function revokeCredential(args: string[]) {
  const [credentialId, actorUserId] = args;
  if (!credentialId || !actorUserId) usage();
  const credential = await prisma.agentAccessToken.findUnique({
    where: { id: credentialId },
    select: { id: true, organizationId: true, clientId: true, revokedAt: true },
  });
  if (!credential) throw new Error("Credential unavailable");
  await requireAdministrator(credential.organizationId, actorUserId);
  if (credential.revokedAt) {
    process.stdout.write("Credential already revoked\n");
    return;
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.agentAccessToken.updateMany({
      where: { id: credential.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) return;
    await tx.auditEvent.create({
      data: {
        organizationId: credential.organizationId,
        clientId: credential.clientId,
        actorType: "USER",
        actorId: actorUserId,
        action: "agent.credential.revoked",
        entityType: "AgentAccessToken",
        entityId: credential.id,
      },
    });
  });
  process.stdout.write("Credential revoked\n");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "create") await createCredential(args);
  else if (command === "revoke") await revokeCredential(args);
  else usage();
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Credential operation failed"}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
