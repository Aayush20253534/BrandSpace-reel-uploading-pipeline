-- CreateEnum
CREATE TYPE "MediaAssetKind" AS ENUM ('RAW_VIDEO', 'RAW_IMAGE', 'AUDIO', 'BRAND_ASSET', 'GENERATED_REEL', 'THUMBNAIL', 'SUBTITLE', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaAssetState" AS ENUM ('DISCOVERED', 'READY', 'ANALYZING', 'ANALYZED', 'INVALID', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnalysisState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReelProjectState" AS ENUM ('DRAFT', 'PLANNED', 'RENDERING', 'QA', 'AWAITING_APPROVAL', 'REVISION_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'REJECTED', 'RENDER_FAILED', 'PUBLISH_FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "QaDecision" AS ENUM ('PENDING', 'PASS', 'FAIL', 'NEEDS_REVISION');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED');

-- CreateEnum
CREATE TYPE "PublishingState" AS ENUM ('SCHEDULED', 'DISPATCHED', 'PROCESSING', 'PUBLISHED', 'RETRY_WAIT', 'FAILED', 'NEEDS_ATTENTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'AI', 'MCP_AGENT', 'WORKER');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('AI', 'TRANSCRIPTION', 'RENDER', 'STORAGE', 'PUBLISHING', 'OTHER');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "MediaAssetKind" NOT NULL,
    "state" "MediaAssetState" NOT NULL DEFAULT 'DISCOVERED',
    "driveFileId" TEXT NOT NULL,
    "driveRevisionId" TEXT,
    "parentDriveId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "capturedAt" TIMESTAMP(3),
    "usageExpiresAt" TIMESTAMP(3),
    "rightsMetadata" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAnalysis" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "state" "AnalysisState" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "transcript" TEXT,
    "language" TEXT,
    "tags" TEXT[],
    "subjects" TEXT[],
    "scenes" JSONB,
    "usableSegments" JSONB,
    "quality" JSONB,
    "visual" JSONB,
    "embeddingRef" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelProject" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT,
    "campaignKey" TEXT,
    "state" "ReelProjectState" NOT NULL DEFAULT 'DRAFT',
    "activeVersion" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReelProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelVersion" (
    "id" TEXT NOT NULL,
    "reelProjectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "blueprint" JSONB NOT NULL,
    "caption" TEXT,
    "cta" TEXT,
    "renderedAssetId" TEXT,
    "previewAssetId" TEXT,
    "changeSummary" TEXT,
    "createdByActorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "createdByActorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelSource" (
    "id" TEXT NOT NULL,
    "reelVersionId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "inMs" INTEGER,
    "outMs" INTEGER,
    "role" TEXT,

    CONSTRAINT "ReelSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "reelVersionId" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaReview" (
    "id" TEXT NOT NULL,
    "reelVersionId" TEXT NOT NULL,
    "technical" JSONB,
    "creative" JSONB,
    "decision" "QaDecision" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "reelProjectId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingJob" (
    "id" TEXT NOT NULL,
    "reelProjectId" TEXT NOT NULL,
    "reelVersionId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" "PublishingState" NOT NULL DEFAULT 'SCHEDULED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "externalContainerId" TEXT,
    "externalMediaId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "lockedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "publishingJobId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "ReelAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProvenance" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reelProjectId" TEXT,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT,
    "inputReference" JSONB,
    "structuredOutput" JSONB,
    "confidence" DECIMAL(5,4),
    "latencyMs" INTEGER,
    "costUsd" DECIMAL(12,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLedger" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reelProjectId" TEXT,
    "kind" "UsageKind" NOT NULL,
    "provider" TEXT,
    "operation" TEXT NOT NULL,
    "model" TEXT,
    "quantity" DECIMAL(18,6),
    "unit" TEXT,
    "inputUnits" INTEGER,
    "outputUnits" INTEGER,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_clientId_state_kind_idx" ON "MediaAsset"("clientId", "state", "kind");

-- CreateIndex
CREATE INDEX "MediaAsset_clientId_checksum_idx" ON "MediaAsset"("clientId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_clientId_driveFileId_key" ON "MediaAsset"("clientId", "driveFileId");

-- CreateIndex
CREATE INDEX "MediaAnalysis_mediaAssetId_state_idx" ON "MediaAnalysis"("mediaAssetId", "state");

-- CreateIndex
CREATE INDEX "ReelProject_clientId_state_createdAt_idx" ON "ReelProject"("clientId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "ReelProject_clientId_campaignKey_idx" ON "ReelProject"("clientId", "campaignKey");

-- CreateIndex
CREATE INDEX "ReelVersion_reelProjectId_createdAt_idx" ON "ReelVersion"("reelProjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReelVersion_reelProjectId_version_key" ON "ReelVersion"("reelProjectId", "version");

-- CreateIndex
CREATE INDEX "ReelSource_mediaAssetId_idx" ON "ReelSource"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "ReelSource_reelVersionId_mediaAssetId_order_key" ON "ReelSource"("reelVersionId", "mediaAssetId", "order");

-- CreateIndex
CREATE INDEX "RenderJob_state_createdAt_idx" ON "RenderJob"("state", "createdAt");

-- CreateIndex
CREATE INDEX "RenderJob_reelVersionId_createdAt_idx" ON "RenderJob"("reelVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "QaReview_reelVersionId_decision_idx" ON "QaReview"("reelVersionId", "decision");

-- CreateIndex
CREATE INDEX "Approval_reelProjectId_decision_idx" ON "Approval"("reelProjectId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingJob_idempotencyKey_key" ON "PublishingJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishingJob_state_scheduledAt_idx" ON "PublishingJob"("state", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublishingJob_reelProjectId_createdAt_idx" ON "PublishingJob"("reelProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "PublishingJob_socialAccountId_scheduledAt_idx" ON "PublishingJob"("socialAccountId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ReelAnalyticsSnapshot_capturedAt_idx" ON "ReelAnalyticsSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReelAnalyticsSnapshot_publishingJobId_capturedAt_key" ON "ReelAnalyticsSnapshot"("publishingJobId", "capturedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_clientId_createdAt_idx" ON "AuditEvent"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AiProvenance_clientId_operation_createdAt_idx" ON "AiProvenance"("clientId", "operation", "createdAt");

-- CreateIndex
CREATE INDEX "AiProvenance_reelProjectId_createdAt_idx" ON "AiProvenance"("reelProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLedger_clientId_occurredAt_idx" ON "UsageLedger"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageLedger_reelProjectId_occurredAt_idx" ON "UsageLedger"("reelProjectId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageLedger_kind_provider_occurredAt_idx" ON "UsageLedger"("kind", "provider", "occurredAt");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAnalysis" ADD CONSTRAINT "MediaAnalysis_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelProject" ADD CONSTRAINT "ReelProject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelVersion" ADD CONSTRAINT "ReelVersion_reelProjectId_fkey" FOREIGN KEY ("reelProjectId") REFERENCES "ReelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelSource" ADD CONSTRAINT "ReelSource_reelVersionId_fkey" FOREIGN KEY ("reelVersionId") REFERENCES "ReelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelSource" ADD CONSTRAINT "ReelSource_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_reelVersionId_fkey" FOREIGN KEY ("reelVersionId") REFERENCES "ReelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReview" ADD CONSTRAINT "QaReview_reelVersionId_fkey" FOREIGN KEY ("reelVersionId") REFERENCES "ReelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_reelProjectId_fkey" FOREIGN KEY ("reelProjectId") REFERENCES "ReelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_reelProjectId_fkey" FOREIGN KEY ("reelProjectId") REFERENCES "ReelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_reelVersionId_fkey" FOREIGN KEY ("reelVersionId") REFERENCES "ReelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelAnalyticsSnapshot" ADD CONSTRAINT "ReelAnalyticsSnapshot_publishingJobId_fkey" FOREIGN KEY ("publishingJobId") REFERENCES "PublishingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProvenance" ADD CONSTRAINT "AiProvenance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
