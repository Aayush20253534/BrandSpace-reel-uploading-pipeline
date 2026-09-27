CREATE TABLE "ReelFeedbackObservation" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "reelVersionId" TEXT NOT NULL,
  "publishingJobId" TEXT,
  "analyticsSnapshotId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "features" JSONB NOT NULL,
  "providerMetrics" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReelFeedbackObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReelFeedbackObservation_sourceKey_key"
  ON "ReelFeedbackObservation"("sourceKey");
CREATE INDEX "ReelFeedbackObservation_clientId_observedAt_idx"
  ON "ReelFeedbackObservation"("clientId", "observedAt");
CREATE INDEX "ReelFeedbackObservation_reelVersionId_observedAt_idx"
  ON "ReelFeedbackObservation"("reelVersionId", "observedAt");
CREATE INDEX "ReelFeedbackObservation_analyticsSnapshotId_idx"
  ON "ReelFeedbackObservation"("analyticsSnapshotId");

ALTER TABLE "ReelFeedbackObservation" ADD CONSTRAINT "ReelFeedbackObservation_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReelFeedbackObservation" ADD CONSTRAINT "ReelFeedbackObservation_reelVersionId_fkey"
  FOREIGN KEY ("reelVersionId") REFERENCES "ReelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReelFeedbackObservation" ADD CONSTRAINT "ReelFeedbackObservation_publishingJobId_fkey"
  FOREIGN KEY ("publishingJobId") REFERENCES "PublishingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReelFeedbackObservation" ADD CONSTRAINT "ReelFeedbackObservation_analyticsSnapshotId_fkey"
  FOREIGN KEY ("analyticsSnapshotId") REFERENCES "ReelAnalyticsSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
