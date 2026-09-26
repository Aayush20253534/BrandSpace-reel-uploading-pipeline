CREATE TABLE "AgentMutation" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentMutation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentMutation_credentialId_toolName_idempotencyKey_key"
  ON "AgentMutation"("credentialId", "toolName", "idempotencyKey");
CREATE INDEX "AgentMutation_createdAt_idx" ON "AgentMutation"("createdAt");

ALTER TABLE "AgentMutation" ADD CONSTRAINT "AgentMutation_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "AgentAccessToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
