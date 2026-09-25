-- Phase 11.2: durable, one-time Instagram OAuth state.

CREATE TABLE "SocialOAuthAttempt" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "SocialPlatform" NOT NULL DEFAULT 'INSTAGRAM',
  "stateHash" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SocialOAuthAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialOAuthAttempt_stateHash_key"
  ON "SocialOAuthAttempt"("stateHash");

CREATE INDEX "SocialOAuthAttempt_clientId_provider_createdAt_idx"
  ON "SocialOAuthAttempt"("clientId", "provider", "createdAt");

CREATE INDEX "SocialOAuthAttempt_userId_expiresAt_idx"
  ON "SocialOAuthAttempt"("userId", "expiresAt");

ALTER TABLE "SocialOAuthAttempt"
  ADD CONSTRAINT "SocialOAuthAttempt_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialOAuthAttempt"
  ADD CONSTRAINT "SocialOAuthAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
