import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { createLogger } from "@forge/logger";
import {
  GoogleDriveMediaStorage,
  S3TemporaryMediaDelivery,
  type GoogleDriveMediaStorageOptions,
  type MediaObject,
  type MediaStorage,
  type TemporaryMediaDelivery,
} from "@forge/storage";

const logger = createLogger("publication-media");

export const PUBLICATION_MAX_BYTES = 512 * 1024 * 1024;
const OBJECT_TTL_MS = 48 * 60 * 60 * 1_000;
const URL_TTL_SECONDS = 24 * 60 * 60;
const LEASE_MS = 30 * 60 * 1_000;
const MIN_REMAINING_MS = 30 * 60 * 1_000;

export interface GeneratedReelAsset {
  id: string;
  clientId: string;
  driveFileId: string;
  driveRevisionId: string | null;
  checksum: string | null;
  kind: string;
  state: string;
  mimeType: string;
  sizeBytes: bigint | null;
  metadata: unknown;
}

export function assertGeneratedReelAsset(
  asset: GeneratedReelAsset,
  clientId: string,
  reelVersionId: string,
) {
  const metadata =
    asset.metadata &&
    typeof asset.metadata === "object" &&
    !Array.isArray(asset.metadata)
      ? (asset.metadata as Record<string, unknown>)
      : null;
  if (
    asset.clientId !== clientId ||
    asset.kind !== "GENERATED_REEL" ||
    asset.state !== "READY" ||
    asset.mimeType !== "video/mp4" ||
    metadata?.generatedBy !== "reel.render" ||
    metadata?.reelVersionId !== reelVersionId
  ) {
    throw new Error("Publication source is not the owned generated MP4 reel");
  }
  if (
    asset.sizeBytes === null ||
    asset.sizeBytes <= 0n ||
    asset.sizeBytes > BigInt(PUBLICATION_MAX_BYTES)
  ) {
    throw new Error(
      "Publication source exceeds the configured media size limit",
    );
  }
}

export function assertCanonicalMediaMatches(
  asset: GeneratedReelAsset,
  canonical: MediaObject,
) {
  if (
    canonical.id !== asset.driveFileId ||
    canonical.mimeType !== "video/mp4" ||
    canonical.sizeBytes !== Number(asset.sizeBytes) ||
    (asset.driveRevisionId && asset.driveRevisionId !== canonical.revisionId) ||
    (asset.checksum && asset.checksum !== canonical.checksum)
  ) {
    throw new Error("Canonical generated reel changed after rendering");
  }
}

export function publicationObjectKey(input: {
  clientId: string;
  publishingJobId: string;
  mediaAssetId: string;
  driveRevisionId: string | null;
}) {
  const digest = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return `publication/${digest.slice(0, 2)}/${digest}.mp4`;
}

export function createCanonicalStorage(): GoogleDriveMediaStorage {
  const required = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`${name} is required for publication media`);
    return value;
  };
  const base = {
    mode: env.GOOGLE_DRIVE_MODE,
    rootFolderId: required(
      env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
      "GOOGLE_DRIVE_ROOT_FOLDER_ID",
    ),
    ...(env.GOOGLE_DRIVE_ID ? { driveId: env.GOOGLE_DRIVE_ID } : {}),
  };
  const options: GoogleDriveMediaStorageOptions =
    env.GOOGLE_DRIVE_AUTH_MODE === "oauth"
      ? {
          ...base,
          authMode: "oauth",
          oauthClientId: required(
            env.GOOGLE_OAUTH_CLIENT_ID,
            "GOOGLE_OAUTH_CLIENT_ID",
          ),
          oauthClientSecret: required(
            env.GOOGLE_OAUTH_CLIENT_SECRET,
            "GOOGLE_OAUTH_CLIENT_SECRET",
          ),
          oauthRefreshToken: required(
            env.GOOGLE_OAUTH_REFRESH_TOKEN,
            "GOOGLE_OAUTH_REFRESH_TOKEN",
          ),
        }
      : {
          ...base,
          authMode: "service-account",
          serviceAccountEmail: required(
            env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            "GOOGLE_SERVICE_ACCOUNT_EMAIL",
          ),
          privateKey: required(
            env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
            "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
          ),
        };
  return new GoogleDriveMediaStorage(options);
}

export function createTemporaryDelivery(): TemporaryMediaDelivery {
  const required = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`${name} is required for publication media`);
    return value;
  };
  return new S3TemporaryMediaDelivery({
    endpoint: required(env.PUBLICATION_S3_ENDPOINT, "PUBLICATION_S3_ENDPOINT"),
    region: required(env.PUBLICATION_S3_REGION, "PUBLICATION_S3_REGION"),
    bucket: required(env.PUBLICATION_S3_BUCKET, "PUBLICATION_S3_BUCKET"),
    accessKeyId: required(
      env.PUBLICATION_S3_ACCESS_KEY_ID,
      "PUBLICATION_S3_ACCESS_KEY_ID",
    ),
    secretAccessKey: required(
      env.PUBLICATION_S3_SECRET_ACCESS_KEY,
      "PUBLICATION_S3_SECRET_ACCESS_KEY",
    ),
  });
}

export async function preparePublicationMedia(
  publishingJobId: string,
  canonicalStorage: MediaStorage,
  delivery: TemporaryMediaDelivery,
  now = new Date(),
) {
  const job = await prisma.publishingJob.findUnique({
    where: { id: publishingJobId },
    select: {
      id: true,
      state: true,
      reelVersionId: true,
      reelProject: { select: { clientId: true } },
      socialAccount: { select: { clientId: true } },
      reelVersion: { select: { renderedAssetId: true } },
    },
  });
  if (!job || !["DISPATCHED", "PROCESSING"].includes(job.state)) {
    throw new Error("Publishing job is not ready for media delivery");
  }
  const clientId = job.reelProject.clientId;
  if (job.socialAccount.clientId !== clientId) {
    throw new Error("Publishing account is outside the reel client");
  }
  const assetId = job.reelVersion.renderedAssetId;
  if (!assetId) throw new Error("Reel version has no rendered artifact");
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      clientId: true,
      driveFileId: true,
      driveRevisionId: true,
      checksum: true,
      kind: true,
      state: true,
      mimeType: true,
      sizeBytes: true,
      metadata: true,
    },
  });
  if (!asset) throw new Error("Rendered artifact record is missing");
  assertGeneratedReelAsset(asset, clientId, job.reelVersionId);

  const key = publicationObjectKey({
    clientId,
    publishingJobId,
    mediaAssetId: asset.id,
    driveRevisionId: asset.driveRevisionId,
  });
  let record = await prisma.publicationMediaDelivery.findUnique({
    where: { publishingJobId },
  });
  if (!record) {
    try {
      record = await prisma.publicationMediaDelivery.create({
        data: {
          publishingJobId,
          mediaAssetId: asset.id,
          objectKey: key,
          sizeBytes: asset.sizeBytes!,
          expiresAt: new Date(now.getTime() + OBJECT_TTL_MS),
        },
      });
    } catch {
      record = await prisma.publicationMediaDelivery.findUnique({
        where: { publishingJobId },
      });
    }
  }
  if (!record || record.objectKey !== key || record.mediaAssetId !== asset.id) {
    throw new Error(
      "Publication delivery conflicts with the rendered artifact",
    );
  }

  const minExpiry = new Date(now.getTime() + MIN_REMAINING_MS);
  if (record.state === "READY" && record.expiresAt > minExpiry) {
    const remote = await delivery.inspect(key);
    if (
      remote?.sizeBytes === Number(asset.sizeBytes) &&
      remote.mimeType === "video/mp4"
    ) {
      const seconds = Math.min(
        URL_TTL_SECONDS,
        Math.floor((record.expiresAt.getTime() - now.getTime()) / 1000) - 60,
      );
      return delivery.signedReadUrl(key, seconds);
    }
  }

  const staleBefore = new Date(now.getTime() - LEASE_MS);
  const claim = await prisma.publicationMediaDelivery.updateMany({
    where: {
      id: record.id,
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    data: { state: "PREPARING", lockedAt: now, deletedAt: null },
  });
  if (claim.count !== 1) {
    throw new Error("Publication media is being prepared by another worker");
  }

  const workDir = await mkdtemp(join(tmpdir(), "brandspace-publication-"));
  const sourcePath = join(workDir, "reel.mp4");
  try {
    const canonical = await canonicalStorage.getMetadata(asset.driveFileId);
    assertCanonicalMediaMatches(asset, canonical);
    let remote = await delivery.inspect(key);
    if (
      remote?.sizeBytes !== Number(asset.sizeBytes) ||
      remote.mimeType !== "video/mp4"
    ) {
      await canonicalStorage.downloadToFile(asset.driveFileId, sourcePath);
      const local = await stat(sourcePath);
      if (local.size !== Number(asset.sizeBytes)) {
        throw new Error(
          "Downloaded generated reel size does not match its record",
        );
      }
      if (asset.checksum) {
        const hash = createHash("md5");
        for await (const chunk of createReadStream(sourcePath)) {
          hash.update(chunk);
        }
        if (hash.digest("hex") !== asset.checksum) {
          throw new Error(
            "Downloaded generated reel checksum does not match its record",
          );
        }
      }
      await delivery.upload({
        key,
        sourcePath,
        mimeType: "video/mp4",
        sizeBytes: local.size,
      });
      remote = await delivery.inspect(key);
      if (remote?.sizeBytes !== local.size || remote.mimeType !== "video/mp4") {
        throw new Error("Temporary publication upload could not be verified");
      }
    }
    const expiresAt = new Date(now.getTime() + OBJECT_TTL_MS);
    const ready = await prisma.publicationMediaDelivery.updateMany({
      where: { id: record.id, lockedAt: now },
      data: { state: "READY", expiresAt, lockedAt: null },
    });
    if (ready.count !== 1) {
      throw new Error("Publication delivery lease expired before completion");
    }
    return delivery.signedReadUrl(key, URL_TTL_SECONDS);
  } catch (error) {
    await prisma.publicationMediaDelivery.updateMany({
      where: { id: record.id, lockedAt: now },
      data: { lockedAt: null },
    });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function cleanupPublicationMedia(
  delivery: TemporaryMediaDelivery,
  now = new Date(),
) {
  const records = await prisma.publicationMediaDelivery.findMany({
    where: {
      state: { in: ["READY", "PREPARING"] },
      OR: [
        { expiresAt: { lte: now } },
        { publishingJob: { state: "PUBLISHED" } },
      ],
    },
    orderBy: { expiresAt: "asc" },
    take: 100,
  });
  let deleted = 0;
  for (const record of records) {
    const claimed = await prisma.publicationMediaDelivery.updateMany({
      where: {
        id: record.id,
        state: record.state,
        AND: [
          {
            OR: [
              { expiresAt: { lte: now } },
              { publishingJob: { state: "PUBLISHED" } },
            ],
          },
          {
            OR: [
              { lockedAt: null },
              { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
            ],
          },
        ],
      },
      data: { lockedAt: now },
    });
    if (claimed.count !== 1) continue;
    try {
      await delivery.delete(record.objectKey);
      await prisma.publicationMediaDelivery.updateMany({
        where: { id: record.id, lockedAt: now },
        data: { state: "DELETED", deletedAt: new Date(), lockedAt: null },
      });
      deleted += 1;
    } catch (error) {
      await prisma.publicationMediaDelivery.updateMany({
        where: { id: record.id, lockedAt: now },
        data: { lockedAt: null },
      });
      logger.error("publication_media_cleanup_failed", {
        deliveryId: record.id,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return { scanned: records.length, deleted };
}
