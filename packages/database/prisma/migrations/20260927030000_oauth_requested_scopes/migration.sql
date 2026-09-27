ALTER TABLE "SocialOAuthAttempt"
ADD COLUMN "requestedScopes" TEXT[] NOT NULL DEFAULT ARRAY[
  'instagram_business_basic',
  'instagram_business_content_publish'
]::TEXT[];
