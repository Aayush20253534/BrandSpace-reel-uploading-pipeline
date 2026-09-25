-- Phase 11.3: observable, leased Instagram long-lived-token maintenance.

ALTER TABLE "SocialAccount"
  ADD COLUMN "tokenIssuedAt" TIMESTAMP(3),
  ADD COLUMN "lastRefreshAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastRefreshedAt" TIMESTAMP(3),
  ADD COLUMN "tokenRefreshLockedAt" TIMESTAMP(3),
  ADD COLUMN "lastAuthErrorCode" TEXT,
  ADD COLUMN "lastAuthErrorMessage" TEXT;

-- Phase 11.2 already stored long-lived tokens. Their connection timestamp is the
-- best durable approximation of issuance time for enforcing Meta's minimum token
-- age before refresh.
UPDATE "SocialAccount"
SET "tokenIssuedAt" = COALESCE("connectedAt", "createdAt")
WHERE
  "accessTokenCiphertext" IS NOT NULL
  AND "tokenIssuedAt" IS NULL;

CREATE INDEX "SocialAccount_platform_status_tokenExpiresAt_idx"
  ON "SocialAccount"("platform", "status", "tokenExpiresAt");

CREATE INDEX "SocialAccount_platform_status_tokenRefreshLockedAt_idx"
  ON "SocialAccount"("platform", "status", "tokenRefreshLockedAt");
