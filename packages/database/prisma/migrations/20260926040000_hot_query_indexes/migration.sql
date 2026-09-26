-- Match the bounded operator lists and worker reconciliation order.
-- Apply in a staged release window: ordinary PostgreSQL index builds can
-- briefly block writes on large tables.
CREATE INDEX "MediaAsset_clientId_createdAt_id_idx"
  ON "MediaAsset"("clientId", "createdAt", "id");

CREATE INDEX "ReelProject_clientId_updatedAt_id_idx"
  ON "ReelProject"("clientId", "updatedAt", "id");

CREATE INDEX "SocialAccount_clientId_updatedAt_id_idx"
  ON "SocialAccount"("clientId", "updatedAt", "id");

CREATE INDEX "PublishingJob_state_scheduledAt_createdAt_idx"
  ON "PublishingJob"("state", "scheduledAt", "createdAt");

CREATE INDEX "AuditEvent_clientId_createdAt_id_idx"
  ON "AuditEvent"("clientId", "createdAt", "id");

DROP INDEX "PublishingJob_state_scheduledAt_idx";
DROP INDEX "AuditEvent_clientId_createdAt_idx";
