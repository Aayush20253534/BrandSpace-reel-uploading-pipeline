-- A connected Instagram account may belong to only one client. Keep historical
-- disconnected/disabled rows so ownership can be deliberately transferred.
-- Stop before changing the index if existing active records need reconciliation.
ALTER TABLE "SocialOAuthAttempt"
  ADD COLUMN "resultCiphertext" TEXT,
  ADD COLUMN "resultRecordedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SocialAccount"
    WHERE "status" IN ('CONNECTED', 'NEEDS_REAUTH')
    GROUP BY "platform", "providerAccountId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active social-account ownership must be reconciled before migration';
  END IF;
END
$$;

CREATE UNIQUE INDEX "SocialAccount_one_active_owner_key"
  ON "SocialAccount"("platform", "providerAccountId")
  WHERE "status" IN ('CONNECTED', 'NEEDS_REAUTH');
