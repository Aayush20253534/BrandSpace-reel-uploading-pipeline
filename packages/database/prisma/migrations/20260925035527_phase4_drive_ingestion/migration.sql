-- CreateTable
CREATE TABLE "DriveSyncState" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startPageToken" TEXT,
    "lastPageToken" TEXT,
    "lastFullSyncAt" TIMESTAMP(3),
    "lastChangeSyncAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveSyncState_clientId_key" ON "DriveSyncState"("clientId");

-- CreateIndex
CREATE INDEX "DriveSyncState_updatedAt_idx" ON "DriveSyncState"("updatedAt");

-- AddForeignKey
ALTER TABLE "DriveSyncState" ADD CONSTRAINT "DriveSyncState_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
