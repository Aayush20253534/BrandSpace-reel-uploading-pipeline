import type {
  MediaAssetKind,
  MediaAssetState,
  Prisma,
  PrismaClient,
} from "@forge/database";
import {
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type MediaObject,
  type MediaStorage,
} from "@forge/storage";

const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";

const MIME_KIND_RULES: ReadonlyArray<{
  prefix: string;
  kind: MediaAssetKind;
}> = [
  { prefix: "video/", kind: "RAW_VIDEO" },
  { prefix: "image/", kind: "RAW_IMAGE" },
  { prefix: "audio/", kind: "AUDIO" },
];

export interface DriveIngestionSummary {
  clientId: string;
  folderId: string;
  discovered: number;
  created: number;
  updated: number;
  skippedFolders: number;
  skippedUnsupported: number;
  startPageToken: string;
}

export interface DriveIngestionDatabase {
  client: Pick<PrismaClient["client"], "findUnique">;
  mediaAsset: Pick<PrismaClient["mediaAsset"], "findUnique" | "upsert">;
  driveSyncState: Pick<PrismaClient["driveSyncState"], "upsert">;
}

export interface DriveIngestionStorage extends MediaStorage {
  getStartPageToken(): Promise<string>;
}

const classifyMedia = (
  item: MediaObject,
): { kind: MediaAssetKind; state: MediaAssetState } | null => {
  if (
    item.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE ||
    item.mimeType.startsWith(GOOGLE_NATIVE_PREFIX)
  ) {
    return null;
  }

  const rule = MIME_KIND_RULES.find(({ prefix }) =>
    item.mimeType.startsWith(prefix),
  );
  if (!rule) return null;

  return { kind: rule.kind, state: "READY" };
};

const toMetadata = (item: MediaObject): Prisma.InputJsonValue => ({
  source: "google-drive",
  ...(item.createdAt ? { driveCreatedAt: item.createdAt.toISOString() } : {}),
  ...(item.modifiedAt
    ? { driveModifiedAt: item.modifiedAt.toISOString() }
    : {}),
});

export async function ingestClientDriveFolder(input: {
  clientId: string;
  storage: DriveIngestionStorage;
  database: DriveIngestionDatabase;
}): Promise<DriveIngestionSummary> {
  const client = await input.database.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, driveFolderId: true },
  });

  if (!client) throw new Error(`Client not found: ${input.clientId}`);
  if (!client.driveFolderId) {
    throw new Error(`Client ${input.clientId} has no driveFolderId`);
  }

  const folder = await input.storage.getMetadata(client.driveFolderId);
  if (folder.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
    throw new Error(`Client ${input.clientId} driveFolderId is not a folder`);
  }

  // Capture the baseline before scanning. Persist it only after all DB writes succeed,
  // so later change-feed processing can safely start from this point.
  const startPageToken = await input.storage.getStartPageToken();
  const children = await input.storage.listChildren(client.driveFolderId);

  let created = 0;
  let updated = 0;
  let skippedFolders = 0;
  let skippedUnsupported = 0;

  for (const item of children) {
    if (item.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
      skippedFolders += 1;
      continue;
    }

    const classification = classifyMedia(item);
    if (!classification) {
      skippedUnsupported += 1;
      continue;
    }

    const key = {
      clientId: client.id,
      driveFileId: item.id,
    };

    const existing = await input.database.mediaAsset.findUnique({
      where: { clientId_driveFileId: key },
      select: { id: true },
    });

    await input.database.mediaAsset.upsert({
      where: { clientId_driveFileId: key },
      create: {
        clientId: client.id,
        kind: classification.kind,
        state: classification.state,
        driveFileId: item.id,
        ...(item.revisionId ? { driveRevisionId: item.revisionId } : {}),
        ...(item.parentIds?.[0] ? { parentDriveId: item.parentIds[0] } : {}),
        name: item.name,
        mimeType: item.mimeType,
        ...(item.sizeBytes !== undefined
          ? { sizeBytes: BigInt(item.sizeBytes) }
          : {}),
        ...(item.checksum ? { checksum: item.checksum } : {}),
        metadata: toMetadata(item),
      },
      update: {
        kind: classification.kind,
        state: classification.state,
        driveRevisionId: item.revisionId ?? null,
        parentDriveId: item.parentIds?.[0] ?? null,
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes !== undefined ? BigInt(item.sizeBytes) : null,
        checksum: item.checksum ?? null,
        metadata: toMetadata(item),
      },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  await input.database.driveSyncState.upsert({
    where: { clientId: client.id },
    create: {
      clientId: client.id,
      startPageToken,
      lastPageToken: startPageToken,
      lastFullSyncAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    update: {
      startPageToken,
      lastPageToken: startPageToken,
      lastFullSyncAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  return {
    clientId: client.id,
    folderId: client.driveFolderId,
    discovered: children.length,
    created,
    updated,
    skippedFolders,
    skippedUnsupported,
    startPageToken,
  };
}
