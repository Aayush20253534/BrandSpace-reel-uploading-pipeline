CREATE TABLE "AgentAccessToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT,
  "label" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "rateWindowStartedAt" TIMESTAMP(3),
  "rateWindowCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentAccessToken_tokenHash_key" ON "AgentAccessToken"("tokenHash");
CREATE INDEX "AgentAccessToken_organizationId_userId_idx" ON "AgentAccessToken"("organizationId", "userId");
CREATE INDEX "AgentAccessToken_expiresAt_idx" ON "AgentAccessToken"("expiresAt");

ALTER TABLE "AgentAccessToken" ADD CONSTRAINT "AgentAccessToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAccessToken" ADD CONSTRAINT "AgentAccessToken_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAccessToken" ADD CONSTRAINT "AgentAccessToken_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
