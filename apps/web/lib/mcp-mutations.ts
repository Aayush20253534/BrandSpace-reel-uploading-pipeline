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

interface RequestApprovalInput {
  clientId: string;
  reelProjectId: string;
  idempotencyKey: string;
}

interface RequestApprovalResult {
  approvalId: string;
  reelProjectId: string;
  reelVersionId: string;
  state: "PENDING";
  reused: boolean;
}

function storedApprovalResult(
  value: Prisma.JsonValue,
  expectedHash: string,
  storedHash: string,
): RequestApprovalResult {
  if (expectedHash !== storedHash) {
    throw new AgentMutationError("IDEMPOTENCY_KEY_REUSED");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentMutationError("IDEMPOTENCY_RESULT_INVALID");
  }
  const row = value as Record<string, Prisma.JsonValue>;
  if (
    typeof row.approvalId !== "string" ||
    typeof row.reelProjectId !== "string" ||
    typeof row.reelVersionId !== "string" ||
    row.state !== "PENDING"
  ) {
    throw new AgentMutationError("IDEMPOTENCY_RESULT_INVALID");
  }
  return {
    approvalId: row.approvalId,
    reelProjectId: row.reelProjectId,
    reelVersionId: row.reelVersionId,
    state: "PENDING",
    reused: true,
  };
}

export async function requestAgentReelApproval(
  context: AgentContext,
  input: RequestApprovalInput,
): Promise<RequestApprovalResult> {
  if (
    context.clientId !== input.clientId ||
    !context.scopes.includes("write") ||
    !CREATE_ROLES.includes(context.role)
  ) {
    throw new AgentMutationError("FORBIDDEN");
  }
  const toolName = "request_reel_approval";
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        clientId: input.clientId,
        reelProjectId: input.reelProjectId,
      }),
    )
    .digest("hex");
  const key = {
    credentialId_toolName_idempotencyKey: {
      credentialId: context.credentialId,
      toolName,
      idempotencyKey: input.idempotencyKey,
    },
  };
  try {
    return await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const [credential, membership, project] = await Promise.all([
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
          tx.reelProject.findFirst({
            where: {
              id: input.reelProjectId,
              clientId: input.clientId,
              client: {
                organizationId: context.organizationId,
                status: "ACTIVE",
              },
            },
            select: {
              id: true,
              state: true,
              activeVersion: true,
              client: { select: { approvalMode: true } },
            },
          }),
        ]);
        if (
          !credential ||
          !membership ||
          !CREATE_ROLES.includes(membership.role)
        ) {
          throw new AgentMutationError("FORBIDDEN");
        }
        if (!project) throw new AgentMutationError("PROJECT_UNAVAILABLE");
        const prior = await tx.agentMutation.findUnique({
          where: key,
          select: { requestHash: true, result: true },
        });
        if (prior)
          return storedApprovalResult(
            prior.result,
            requestHash,
            prior.requestHash,
          );

        const autoApproved =
          project.client.approvalMode === "AUTO" &&
          project.state === "APPROVED";
        if (!autoApproved && project.state !== "AWAITING_APPROVAL") {
          throw new AgentMutationError("PROJECT_NOT_AWAITING_APPROVAL");
        }
        const version = await tx.reelVersion.findUnique({
          where: {
            reelProjectId_version: {
              reelProjectId: project.id,
              version: project.activeVersion,
            },
          },
          select: {
            id: true,
            renderedAssetId: true,
            qaReviews: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { decision: true, technical: true, creative: true },
            },
          },
        });
        const qa = version?.qaReviews[0];
        if (
          !version?.renderedAssetId ||
          !qa ||
          qa.decision !== "PASS" ||
          qa.technical === null ||
          qa.creative === null
        ) {
          throw new AgentMutationError("VERSION_QA_NOT_READY");
        }
        const artifact = await tx.mediaAsset.findFirst({
          where: {
            id: version.renderedAssetId,
            clientId: input.clientId,
            kind: "GENERATED_REEL",
            state: "READY",
          },
          select: { id: true },
        });
        if (!artifact) throw new AgentMutationError("ARTIFACT_UNAVAILABLE");
        if (autoApproved) {
          const reopened = await tx.reelProject.updateMany({
            where: {
              id: project.id,
              state: "APPROVED",
              activeVersion: project.activeVersion,
              publishingJobs: { none: {} },
            },
            data: { state: "AWAITING_APPROVAL" },
          });
          if (reopened.count !== 1) {
            throw new AgentMutationError("PROJECT_CONCURRENT_CHANGE");
          }
        }
        const existing = await tx.approval.findFirst({
          where: {
            reelProjectId: project.id,
            reelVersionId: version.id,
            decision: "PENDING",
          },
          orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        const approval =
          existing ??
          (await tx.approval.create({
            data: {
              reelProjectId: project.id,
              reelVersionId: version.id,
              requestedById: context.userId,
              decision: "PENDING",
            },
            select: { id: true },
          }));
        if (!existing) {
          await tx.auditEvent.create({
            data: {
              organizationId: context.organizationId,
              clientId: input.clientId,
              actorType: "USER",
              actorId: context.userId,
              action: "reel.approval.requested",
              entityType: "Approval",
              entityId: approval.id,
              metadata: {
                source: "mcp",
                credentialId: context.credentialId,
                reelProjectId: project.id,
                reelVersionId: version.id,
              },
            },
          });
        }
        const result: RequestApprovalResult = {
          approvalId: approval.id,
          reelProjectId: project.id,
          reelVersionId: version.id,
          state: "PENDING",
          reused: Boolean(existing),
        };
        await tx.agentMutation.create({
          data: {
            credentialId: context.credentialId,
            toolName,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            result: {
              approvalId: result.approvalId,
              reelProjectId: result.reelProjectId,
              reelVersionId: result.reelVersionId,
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
      if (winner)
        return storedApprovalResult(
          winner.result,
          requestHash,
          winner.requestHash,
        );
    }
    throw error;
  }
}
