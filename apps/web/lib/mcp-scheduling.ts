import { createHash } from "node:crypto";
import { Prisma, prisma } from "@forge/database";
import { buildPublishingIdempotencyKey } from "@forge/domain";
import { assertSocialAccountSchedulable } from "@forge/social";
import type { AgentContext } from "./mcp-auth";
import { AgentMutationError } from "./mcp-mutations";

interface ScheduleInput {
  clientId: string;
  reelProjectId: string;
  socialAccountId: string;
  scheduledAt: string;
  idempotencyKey: string;
}

interface ScheduleResult {
  publishingJobId: string;
  reelProjectId: string;
  reelVersionId: string;
  socialAccountId: string;
  scheduledAt: string;
  state: "SCHEDULED";
  reused: boolean;
}

const SCHEDULE_ROLES = ["OWNER", "ADMIN", "CONTENT_MANAGER"];
const TOOL_NAME = "schedule_approved_reel";

function storedScheduleResult(
  value: Prisma.JsonValue,
  expectedHash: string,
  storedHash: string,
): ScheduleResult {
  if (expectedHash !== storedHash)
    throw new AgentMutationError("IDEMPOTENCY_KEY_REUSED");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AgentMutationError("IDEMPOTENCY_RESULT_INVALID");
  const row = value as Record<string, Prisma.JsonValue>;
  if (
    typeof row.publishingJobId !== "string" ||
    typeof row.reelProjectId !== "string" ||
    typeof row.reelVersionId !== "string" ||
    typeof row.socialAccountId !== "string" ||
    typeof row.scheduledAt !== "string" ||
    row.state !== "SCHEDULED"
  )
    throw new AgentMutationError("IDEMPOTENCY_RESULT_INVALID");
  return {
    publishingJobId: row.publishingJobId,
    reelProjectId: row.reelProjectId,
    reelVersionId: row.reelVersionId,
    socialAccountId: row.socialAccountId,
    scheduledAt: row.scheduledAt,
    state: "SCHEDULED",
    reused: true,
  };
}

export async function scheduleApprovedReel(
  context: AgentContext,
  input: ScheduleInput,
): Promise<ScheduleResult> {
  if (
    context.clientId !== input.clientId ||
    !context.scopes.includes("write") ||
    !SCHEDULE_ROLES.includes(context.role)
  )
    throw new AgentMutationError("FORBIDDEN");

  const scheduledAt = new Date(input.scheduledAt);
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    scheduledAt.toISOString() !== input.scheduledAt
  )
    throw new AgentMutationError("INVALID_SCHEDULE_TIME");
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        clientId: input.clientId,
        reelProjectId: input.reelProjectId,
        socialAccountId: input.socialAccountId,
        scheduledAt: input.scheduledAt,
      }),
    )
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
        const [credential, membership, project, account] = await Promise.all([
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
            select: { id: true, state: true, activeVersion: true },
          }),
          tx.socialAccount.findFirst({
            where: { id: input.socialAccountId, clientId: input.clientId },
            select: {
              id: true,
              clientId: true,
              platform: true,
              status: true,
              scopes: true,
              accessTokenCiphertext: true,
              tokenExpiresAt: true,
            },
          }),
        ]);
        if (
          !credential ||
          !membership ||
          !SCHEDULE_ROLES.includes(membership.role)
        )
          throw new AgentMutationError("FORBIDDEN");
        if (!project) throw new AgentMutationError("PROJECT_UNAVAILABLE");
        const prior = await tx.agentMutation.findUnique({
          where: key,
          select: { requestHash: true, result: true },
        });
        if (prior)
          return storedScheduleResult(
            prior.result,
            requestHash,
            prior.requestHash,
          );

        if (
          scheduledAt.getTime() < now.getTime() + 60_000 ||
          scheduledAt.getTime() > now.getTime() + 90 * 24 * 60 * 60_000
        )
          throw new AgentMutationError("SCHEDULE_TIME_OUT_OF_RANGE");
        if (project.state !== "APPROVED")
          throw new AgentMutationError("PROJECT_NOT_APPROVED");
        if (!account) throw new AgentMutationError("ACCOUNT_UNAVAILABLE");
        try {
          assertSocialAccountSchedulable(account, input.clientId, now);
        } catch {
          throw new AgentMutationError("ACCOUNT_NOT_READY");
        }
        if (!account.scopes.includes("instagram_business_content_publish"))
          throw new AgentMutationError("ACCOUNT_PERMISSION_MISSING");

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
        )
          throw new AgentMutationError("VERSION_QA_NOT_READY");
        const [artifact, approval] = await Promise.all([
          tx.mediaAsset.findFirst({
            where: {
              id: version.renderedAssetId,
              clientId: input.clientId,
              kind: "GENERATED_REEL",
              state: "READY",
            },
            select: { id: true },
          }),
          tx.approval.findFirst({
            where: {
              reelProjectId: project.id,
              reelVersionId: version.id,
              decision: "APPROVED",
            },
            select: { id: true },
          }),
        ]);
        if (!artifact) throw new AgentMutationError("ARTIFACT_UNAVAILABLE");
        if (!approval) throw new AgentMutationError("HUMAN_APPROVAL_REQUIRED");

        const publishingKey = buildPublishingIdempotencyKey(
          version.id,
          account.id,
          scheduledAt,
        );
        const job = await tx.publishingJob.create({
          data: {
            reelProjectId: project.id,
            reelVersionId: version.id,
            socialAccountId: account.id,
            scheduledAt,
            idempotencyKey: publishingKey,
            state: "SCHEDULED",
          },
          select: { id: true },
        });
        const moved = await tx.reelProject.updateMany({
          where: {
            id: project.id,
            state: "APPROVED",
            activeVersion: project.activeVersion,
          },
          data: { state: "SCHEDULED" },
        });
        if (moved.count !== 1)
          throw new AgentMutationError("PROJECT_CONCURRENT_CHANGE");
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            clientId: input.clientId,
            actorType: "USER",
            actorId: context.userId,
            action: "reel.publishing.scheduled",
            entityType: "PublishingJob",
            entityId: job.id,
            metadata: {
              source: "mcp",
              credentialId: context.credentialId,
              reelVersionId: version.id,
              socialAccountId: account.id,
              scheduledAt: input.scheduledAt,
            },
          },
        });
        const result: ScheduleResult = {
          publishingJobId: job.id,
          reelProjectId: project.id,
          reelVersionId: version.id,
          socialAccountId: account.id,
          scheduledAt: input.scheduledAt,
          state: "SCHEDULED",
          reused: false,
        };
        await tx.agentMutation.create({
          data: {
            credentialId: context.credentialId,
            toolName: TOOL_NAME,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            result: {
              publishingJobId: result.publishingJobId,
              reelProjectId: result.reelProjectId,
              reelVersionId: result.reelVersionId,
              socialAccountId: result.socialAccountId,
              scheduledAt: result.scheduledAt,
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
        return storedScheduleResult(
          winner.result,
          requestHash,
          winner.requestHash,
        );
      throw new AgentMutationError("PROJECT_CONCURRENT_CHANGE");
    }
    throw error;
  }
}
