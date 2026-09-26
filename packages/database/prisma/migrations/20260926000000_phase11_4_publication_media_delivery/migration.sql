CREATE TYPE "PublicationMediaDeliveryState" AS ENUM ('PREPARING', 'READY', 'DELETED');

CREATE TABLE "PublicationMediaDelivery" (
  "id" TEXT NOT NULL,
  "publishingJobId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "state" "PublicationMediaDeliveryState" NOT NULL DEFAULT 'PREPARING',
  "sizeBytes" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationMediaDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicationMediaDelivery_publishingJobId_key" ON "PublicationMediaDelivery"("publishingJobId");
CREATE UNIQUE INDEX "PublicationMediaDelivery_objectKey_key" ON "PublicationMediaDelivery"("objectKey");
CREATE INDEX "PublicationMediaDelivery_state_expiresAt_idx" ON "PublicationMediaDelivery"("state", "expiresAt");
CREATE INDEX "PublicationMediaDelivery_mediaAssetId_idx" ON "PublicationMediaDelivery"("mediaAssetId");
ALTER TABLE "PublicationMediaDelivery" ADD CONSTRAINT "PublicationMediaDelivery_publishingJobId_fkey" FOREIGN KEY ("publishingJobId") REFERENCES "PublishingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationMediaDelivery" ADD CONSTRAINT "PublicationMediaDelivery_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
