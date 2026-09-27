import { McpServer } from "@modelcontextprotocol/server";
import { prisma, type MembershipRole } from "@forge/database";
import * as z from "zod/v4";
import type { AgentContext } from "./mcp-auth";
import {
  AgentMutationError,
  createAgentReelProject,
  requestAgentReelApproval,
} from "./mcp-mutations";
import { scheduleApprovedReel } from "./mcp-scheduling";
import { reconcileAgentPublishingQueueJob } from "./mcp-queue-reconcile";

const page = z.number().int().min(1).max(100).default(1);
const limit = z.number().int().min(1).max(50).default(20);
const clientId = z.string().min(1).max(128);
const listInput = z.object({ clientId, page, limit });
const clientInput = z.object({ clientId });

function canRead(role: MembershipRole, section: string) {
  if (role === "ANALYST")
    return section === "analytics" || section === "feedback";
  if (role === "REVIEWER") {
    return ["brand", "projects", "versions", "approvals"].includes(section);
  }
  if (role === "EDITOR") {
    return [
      "brand",
      "media",
      "intelligence",
      "projects",
      "versions",
      "approvals",
      "feedback",
    ].includes(section);
  }
  if (section === "audit" || section === "accounts") {
    return ["OWNER", "ADMIN", "CONTENT_MANAGER"].includes(role);
  }
  return true;
}

async function requireClient(context: AgentContext, id: string) {
  if (context.clientId && context.clientId !== id) {
    throw new Error("CLIENT_UNAVAILABLE");
  }
  const client = await prisma.client.findFirst({
    where: { id, organizationId: context.organizationId },
    select: { id: true },
  });
  if (!client) throw new Error("CLIENT_UNAVAILABLE");
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

async function safeRead(action: () => Promise<unknown>) {
  try {
    return result(await action());
  } catch (error) {
    const message =
      error instanceof Error && error.message === "CLIENT_UNAVAILABLE"
        ? "Client unavailable"
        : "Unable to read Forge data";
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false } as const;

export function createForgeMcpServer(context: AgentContext) {
  const server = new McpServer({ name: "brandspace-forge", version: "0.2.0" });

  if (
    context.clientId &&
    context.scopes.includes("write") &&
    ["OWNER", "ADMIN", "CONTENT_MANAGER", "EDITOR"].includes(context.role)
  ) {
    server.registerTool(
      "create_reel_project",
      {
        description:
          "Create a draft reel project for this credential's client. Requires a fresh UUID idempotency key. This does not plan, approve, schedule, or publish.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
        inputSchema: z.object({
          clientId,
          title: z.string().trim().min(1).max(120),
          objective: z.string().trim().max(1_000).optional(),
          idempotencyKey: z.string().uuid(),
        }),
      },
      async (input) => {
        try {
          return result(await createAgentReelProject(context, input));
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  error instanceof AgentMutationError
                    ? error.code
                    : "Unable to create reel project",
              },
            ],
            isError: true,
          };
        }
      },
    );
    server.registerTool(
      "request_reel_approval",
      {
        description:
          "Request human review of the active reel version only after technical and creative QA pass. This does not approve, schedule, or publish.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
        inputSchema: z.object({
          clientId,
          reelProjectId: z.string().min(1).max(128),
          idempotencyKey: z.string().uuid(),
        }),
      },
      async (input) => {
        try {
          return result(await requestAgentReelApproval(context, input));
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  error instanceof AgentMutationError
                    ? error.code
                    : "Unable to request reel approval",
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  if (
    context.clientId &&
    context.scopes.includes("write") &&
    ["OWNER", "ADMIN", "CONTENT_MANAGER"].includes(context.role)
  ) {
    server.registerTool(
      "schedule_approved_reel",
      {
        description:
          "Schedule one QA-passed reel version for an Instagram account. Requires a recorded human approval for the exact version, even for automatic-approval clients. Creates durable database intent; queue reconciliation dispatches it. A live worker can publish at the scheduled time only when the separate live switch is enabled.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
        inputSchema: z.object({
          clientId,
          reelProjectId: z.string().min(1).max(128),
          socialAccountId: z.string().min(1).max(128),
          scheduledAt: z.string().datetime({ offset: false }),
          idempotencyKey: z.string().uuid(),
        }),
      },
      async (input) => {
        try {
          return result(await scheduleApprovedReel(context, input));
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  error instanceof AgentMutationError
                    ? error.code
                    : "Unable to schedule approved reel",
              },
            ],
            isError: true,
          };
        }
      },
    );
    server.registerTool(
      "reconcile_publishing_queue_job",
      {
        description:
          "Request bounded BullMQ reconciliation for one pending publishing job belonging to this client. Rejects remote-write intents, exhausted attempts and stale schedules. This can trigger publication only when the worker's separate live switch and exact-version human approval gates permit it.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
        inputSchema: z.object({
          clientId,
          publishingJobId: z.string().min(1).max(128),
          idempotencyKey: z.string().uuid(),
        }),
      },
      async (input) => {
        try {
          return result(await reconcileAgentPublishingQueueJob(context, input));
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  error instanceof AgentMutationError
                    ? error.code
                    : "Unable to reconcile publishing queue job",
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  server.registerTool(
    "list_clients",
    {
      description:
        "List clients available to this credential in its organization.",
      annotations: readOnly,
      inputSchema: z.object({ page, limit }),
    },
    async ({ page, limit }) =>
      safeRead(() =>
        prisma.client.findMany({
          where: {
            organizationId: context.organizationId,
            ...(context.clientId ? { id: context.clientId } : {}),
          },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            timezone: true,
            approvalMode: true,
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ),
  );

  if (canRead(context.role, "brand")) {
    server.registerTool(
      "get_brand_profile",
      {
        description: "Read the current brand profile for a client.",
        annotations: readOnly,
        inputSchema: clientInput,
      },
      async ({ clientId }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.brandProfile.findUnique({
            where: { clientId },
            select: {
              positioning: true,
              targetAudience: true,
              audiencePainPoints: true,
              contentPillars: true,
              tone: true,
              preferredHooks: true,
              forbiddenTopics: true,
              preferredWords: true,
              bannedWords: true,
              ctaRules: true,
              captionStyle: true,
              hashtagPolicy: true,
              postingPolicy: true,
              complianceRules: true,
              updatedAt: true,
            },
          });
        }),
    );
  }

  if (canRead(context.role, "media")) {
    server.registerTool(
      "list_media_assets",
      {
        description: "List Google Drive-backed media metadata for a client.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.mediaAsset.findMany({
            where: { clientId },
            select: {
              id: true,
              name: true,
              kind: true,
              state: true,
              mimeType: true,
              durationMs: true,
              width: true,
              height: true,
              capturedAt: true,
              usageExpiresAt: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  if (canRead(context.role, "intelligence")) {
    server.registerTool(
      "list_media_intelligence",
      {
        description:
          "List analysis summaries and quality signals for a client's media.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.mediaAnalysis.findMany({
            where: { mediaAsset: { clientId } },
            select: {
              id: true,
              mediaAssetId: true,
              state: true,
              summary: true,
              language: true,
              tags: true,
              subjects: true,
              quality: true,
              completedAt: true,
              updatedAt: true,
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  if (canRead(context.role, "projects")) {
    server.registerTool(
      "list_reel_projects",
      {
        description:
          "List reel projects and current workflow states for a client.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.reelProject.findMany({
            where: { clientId },
            select: {
              id: true,
              title: true,
              objective: true,
              campaignKey: true,
              state: true,
              activeVersion: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  if (canRead(context.role, "versions")) {
    server.registerTool(
      "get_reel_version",
      {
        description: "Read a numbered reel blueprint and its QA result.",
        annotations: readOnly,
        inputSchema: z.object({
          clientId,
          reelProjectId: z.string().min(1),
          version: z.number().int().positive(),
        }),
      },
      async ({ clientId, reelProjectId, version }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.reelVersion.findFirst({
            where: { reelProjectId, version, reelProject: { clientId } },
            select: {
              id: true,
              version: true,
              blueprint: true,
              caption: true,
              cta: true,
              renderedAssetId: true,
              previewAssetId: true,
              changeSummary: true,
              createdAt: true,
              qaReviews: {
                select: { decision: true, summary: true, createdAt: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          });
        }),
    );
  }

  if (canRead(context.role, "approvals")) {
    server.registerTool(
      "list_approvals",
      {
        description:
          "List version-bound human approval requests and decisions.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.approval.findMany({
            where: { reelProject: { clientId } },
            select: {
              id: true,
              reelProjectId: true,
              reelVersionId: true,
              decision: true,
              requestedAt: true,
              decidedAt: true,
              decidedById: true,
            },
            orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  if (canRead(context.role, "publishing")) {
    server.registerTool(
      "list_publishing_jobs",
      {
        description:
          "List publishing status and stable failure codes, without credentials.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.publishingJob.findMany({
            where: { reelProject: { clientId } },
            select: {
              id: true,
              reelProjectId: true,
              reelVersionId: true,
              socialAccountId: true,
              state: true,
              scheduledAt: true,
              publishedAt: true,
              attemptCount: true,
              lastErrorCode: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  if (canRead(context.role, "accounts")) {
    server.registerTool(
      "list_social_account_health",
      {
        description:
          "List connection and token-expiry health, without access tokens.",
        annotations: readOnly,
        inputSchema: clientInput,
      },
      async ({ clientId }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.socialAccount.findMany({
            where: { clientId },
            select: {
              id: true,
              platform: true,
              providerAccountId: true,
              username: true,
              status: true,
              scopes: true,
              tokenExpiresAt: true,
              lastVerifiedAt: true,
              lastRefreshedAt: true,
              lastAuthErrorCode: true,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
          });
        }),
    );
  }

  if (canRead(context.role, "analytics")) {
    server.registerTool(
      "list_analytics_snapshots",
      {
        description: "List captured performance metrics for published reels.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.reelAnalyticsSnapshot.findMany({
            where: { publishingJob: { reelProject: { clientId } } },
            select: {
              id: true,
              publishingJobId: true,
              capturedAt: true,
              metrics: true,
            },
            orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  if (canRead(context.role, "feedback")) {
    server.registerTool(
      "list_feedback_observations",
      {
        description:
          "List versioned creative features linked to reel versions and optional analytics snapshots. Unknown labels are explicit; this tool does not rank performance.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.reelFeedbackObservation.findMany({
            where: { clientId },
            select: {
              id: true,
              reelVersionId: true,
              publishingJobId: true,
              analyticsSnapshotId: true,
              schemaVersion: true,
              features: true,
              observedAt: true,
            },
            orderBy: [{ observedAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  if (canRead(context.role, "audit")) {
    server.registerTool(
      "list_audit_events",
      {
        description:
          "List audit event identity and action without free-form metadata.",
        annotations: readOnly,
        inputSchema: listInput,
      },
      async ({ clientId, page, limit }) =>
        safeRead(async () => {
          await requireClient(context, clientId);
          return prisma.auditEvent.findMany({
            where: { organizationId: context.organizationId, clientId },
            select: {
              id: true,
              actorType: true,
              actorId: true,
              action: true,
              entityType: true,
              entityId: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
          });
        }),
    );
  }

  return server;
}
