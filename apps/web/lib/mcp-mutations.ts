import { createHash } from "node:crypto";
import { Prisma, prisma } from "@forge/database";
import type { AgentContext } from "./mcp-auth";

export class AgentMutationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentMutationError";
  }
}

interface CreateProjectInput {
  clientId: string;
  title: string;
  objective?: string | undefined;
  idempotencyKey: string;
}

interface CreateProjectResult {
  projectId: string;
  clientId: string;
  title: string;
  objective: string | null;
  state: "DRAFT";
  reused: boolean;
}

const TOOL_NAME = "create_reel_project";
const CREATE_ROLES = ["OWNER", "ADMIN", "CONTENT_MANAGER", "EDITOR"];

function storedResult(
  value: Prisma.JsonValue,
  expectedHash: string,
  storedHash: string,
): CreateProjectResult {
  if (expectedHash !== storedHash) {
    throw new AgentMutationError("IDEMPOTENCY_KEY_REUSED");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentMutationError("IDEMPOTENCY_RESULT_INVALID");
  }
  const row = value as Record<string, Prisma.JsonValue>;
  if (
    typeof row.projectId !== "string" ||
    typeof row.clientId !== "string" ||
    typeof row.title !== "string" ||
    (row.objective !== null && typeof row.objective !== "string") ||
    row.state !== "DRAFT"
  ) {
    throw new AgentMutationError("IDEMPOTENCY_RESULT_INVALID");
  }
  return {
    projectId: row.projectId,
    clientId: row.clientId,
    title: row.title,
    objective: row.objective,
    state: "DRAFT",
    reused: true,
  };
}

export async function createAgentReelProject(
  context: AgentContext,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const title = input.title.trim();
  const objective = input.objective?.trim() || null;
  if (!title || title.length > 120 || (objective && objective.length > 1_000)) {
    throw new AgentMutationError("INVALID_PROJECT_INPUT");
  }
  if (
    context.clientId !== input.clientId ||
    !context.scopes.includes("write")
  ) {
    throw new AgentMutationError("FORBIDDEN");
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ clientId: input.clientId, title, objective }))
    .digest("hex");
  const key = {
    credentialId_toolName_idempotencyKey: {
      credentialId: context.credentialId,
      toolName: TOOL_NAME,
      idempotencyKey: input.idempotencyKey,
    },
  };

  try {
    return await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const [credential, membership, client] = await Promise.all([
          tx.agentAccessToken.findFirst({
            where: {
              id: context.credentialId,
              userId: context.userId,
              organizationId: context.organizationId,
              clientId: input.clientId,
              scopes: { has: "write" },
              revokedAt: null,
              expiresAt: { gt: now },
            },
            select: { id: true },
          }),
          tx.membership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: context.organizationId,
                userId: context.userId,
              },
            },
            select: { role: true },
          }),
          tx.client.findFirst({
            where: {
              id: input.clientId,
              organizationId: context.organizationId,
              status: "ACTIVE",
            },
            select: { id: true },
          }),
        ]);
        if (
          !credential ||
          !membership ||
          !CREATE_ROLES.includes(membership.role)
        ) {
          throw new AgentMutationError("FORBIDDEN");
        }
        if (!client) throw new AgentMutationError("CLIENT_UNAVAILABLE");

        const prior = await tx.agentMutation.findUnique({
          where: key,
          select: { requestHash: true, result: true },
        });
        if (prior) {
          return storedResult(prior.result, requestHash, prior.requestHash);
        }

        const project = await tx.reelProject.create({
          data: {
            clientId: client.id,
            title,
            objective,
            state: "DRAFT",
            createdById: context.userId,
          },
          select: { id: true },
        });
        const result: CreateProjectResult = {
          projectId: project.id,
          clientId: client.id,
          title,
          objective,
          state: "DRAFT",
          reused: false,
        };
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            clientId: client.id,
            actorType: "USER",
            actorId: context.userId,
            action: "reel.project.created",
            entityType: "ReelProject",
            entityId: project.id,
            metadata: { source: "mcp", credentialId: context.credentialId },
          },
        });
        await tx.agentMutation.create({
          data: {
            credentialId: context.credentialId,
            toolName: TOOL_NAME,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            result: {
              projectId: result.projectId,
              clientId: result.clientId,
              title: result.title,
              objective: result.objective,
              state: result.state,
            },
          },
        });
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await prisma.agentMutation.findUnique({
        where: key,
        select: { requestHash: true, result: true },
      });
      if (winner) {
        return storedResult(winner.result, requestHash, winner.requestHash);
      }
    }
    throw error;
  }
}
