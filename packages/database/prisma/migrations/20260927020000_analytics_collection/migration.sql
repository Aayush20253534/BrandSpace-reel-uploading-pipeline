CREATE TYPE "AnalyticsCollectionState" AS ENUM (
  'PENDING', 'RETRY_WAIT', 'COMPLETE', 'NEEDS_ATTENTION'
);

CREATE TABLE "AnalyticsCollection" (
  "id" TEXT NOT NULL,
  "publishingJobId" TEXT NOT NULL,
  "state" "AnalyticsCollectionState" NOT NULL DEFAULT 'PENDING',
  "nextCaptureAt" TIMESTAMP(3) NOT NULL,
  "captureStartedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "capturedCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsCollection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsCollection_publishingJobId_key"
  ON "AnalyticsCollection"("publishingJobId");
CREATE INDEX "AnalyticsCollection_state_nextCaptureAt_lockedAt_idx"
  ON "AnalyticsCollection"("state", "nextCaptureAt", "lockedAt");
ALTER TABLE "AnalyticsCollection" ADD CONSTRAINT "AnalyticsCollection_publishingJobId_fkey"
  FOREIGN KEY ("publishingJobId") REFERENCES "PublishingJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
