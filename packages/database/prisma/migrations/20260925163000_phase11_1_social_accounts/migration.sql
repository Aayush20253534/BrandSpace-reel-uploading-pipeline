-- Phase 11.1: tenant-scoped social accounts and encrypted credential storage.

CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM');

CREATE TYPE "SocialAccountStatus" AS ENUM (
  'PENDING',
  'CONNECTED',
  'NEEDS_REAUTH',
  'DISCONNECTED',
  'DISABLED'
);

CREATE TABLE "SocialAccount" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "platform" "SocialPlatform" NOT NULL DEFAULT 'INSTAGRAM',
  "providerAccountId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "status" "SocialAccountStatus" NOT NULL DEFAULT 'PENDING',
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "accessTokenCiphertext" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "connectedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialAccount_clientId_platform_providerAccountId_key"
  ON "SocialAccount"("clientId", "platform", "providerAccountId");

CREATE INDEX "SocialAccount_clientId_platform_status_idx"
  ON "SocialAccount"("clientId", "platform", "status");

CREATE INDEX "SocialAccount_platform_providerAccountId_idx"
  ON "SocialAccount"("platform", "providerAccountId");

ALTER TABLE "SocialAccount"
  ADD CONSTRAINT "SocialAccount_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve historical Phase 10 jobs by materializing their old free-form account
-- identifiers as disconnected legacy SocialAccount rows. The deterministic ID is
-- scoped by client, so identical old labels used by two clients cannot collide.
INSERT INTO "SocialAccount" (
  "id",
  "clientId",
  "platform",
  "providerAccountId",
  "status",
  "scopes",
  "metadata",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy_' || md5(pj."socialAccountId" || ':' || rp."clientId"),
  rp."clientId",
  'INSTAGRAM'::"SocialPlatform",
  'legacy:' || pj."socialAccountId",
  'DISCONNECTED'::"SocialAccountStatus",
  ARRAY[]::TEXT[],
  jsonb_build_object(
    'legacySocialAccountId', pj."socialAccountId",
    'backfilledFromPublishingJob', true
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "PublishingJob" pj
JOIN "ReelProject" rp ON rp."id" = pj."reelProjectId"
GROUP BY pj."socialAccountId", rp."clientId";

UPDATE "PublishingJob" pj
SET "socialAccountId" =
  'legacy_' || md5(pj."socialAccountId" || ':' || rp."clientId")
FROM "ReelProject" rp
WHERE rp."id" = pj."reelProjectId";

ALTER TABLE "PublishingJob"
  ADD CONSTRAINT "PublishingJob_socialAccountId_fkey"
  FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
