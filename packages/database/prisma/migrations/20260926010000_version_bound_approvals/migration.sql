-- Bind approvals to the exact reel version they reviewed. Legacy rows without
-- an unambiguous request audit remain NULL and cannot authorize new schedules.
ALTER TABLE "Approval" ADD COLUMN "reelVersionId" TEXT;

WITH request_versions AS (
  SELECT
    a."id" AS "approvalId",
    MIN(rv."id") AS "reelVersionId"
  FROM "Approval" AS a
  JOIN "AuditEvent" AS e
    ON e."entityType" = 'Approval'
   AND e."entityId" = a."id"
   AND e."action" = 'reel.approval.requested'
  JOIN "ReelVersion" AS rv
    ON rv."id" = e."metadata"->>'reelVersionId'
   AND rv."reelProjectId" = a."reelProjectId"
  GROUP BY a."id"
  HAVING COUNT(DISTINCT rv."id") = 1
)
UPDATE "Approval" AS a
SET "reelVersionId" = request_versions."reelVersionId"
FROM request_versions
WHERE a."id" = request_versions."approvalId";

CREATE INDEX "Approval_reelVersionId_decision_idx"
  ON "Approval"("reelVersionId", "decision");

ALTER TABLE "Approval" ADD CONSTRAINT "Approval_reelVersionId_fkey"
  FOREIGN KEY ("reelVersionId") REFERENCES "ReelVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
