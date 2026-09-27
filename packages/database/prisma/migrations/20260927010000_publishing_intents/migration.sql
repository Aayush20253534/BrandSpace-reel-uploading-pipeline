ALTER TABLE "PublishingJob"
  ADD COLUMN "containerCreateIntentAt" TIMESTAMP(3),
  ADD COLUMN "publishIntentAt" TIMESTAMP(3),
  ADD COLUMN "mediaPrepareAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "containerPollCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextPollAt" TIMESTAMP(3);

CREATE INDEX "PublishingJob_state_nextPollAt_lockedAt_idx"
  ON "PublishingJob"("state", "nextPollAt", "lockedAt");
