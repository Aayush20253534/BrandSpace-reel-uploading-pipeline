import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";
import { withPreparedMediaAsset } from "../packages/media-intelligence/src/index.ts";
import {
  GoogleDriveMediaStorage,
  type GoogleDriveAuthMode,
  type GoogleDriveMode,
  type GoogleDriveMediaStorageOptions,
} from "../packages/storage/src/index.ts";

loadEnvFile(".env");

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const mediaAssetId = process.argv[2]?.trim();
const outputDirArg = process.argv[3]?.trim();
if (!mediaAssetId) {
  console.error(
    "Usage: npm run media:prepare -- <media-asset-id> [inspection-output-dir]",
  );
  process.exit(1);
}

const driveMode = (process.env.GOOGLE_DRIVE_MODE ??
  "my-drive") as GoogleDriveMode;
if (driveMode !== "my-drive" && driveMode !== "shared-drive") {
  throw new Error("GOOGLE_DRIVE_MODE must be my-drive or shared-drive");
}

const authMode = (process.env.GOOGLE_DRIVE_AUTH_MODE ??
  "service-account") as GoogleDriveAuthMode;
if (authMode !== "oauth" && authMode !== "service-account") {
  throw new Error("GOOGLE_DRIVE_AUTH_MODE must be oauth or service-account");
}

const driveId = process.env.GOOGLE_DRIVE_ID?.trim() || undefined;
const base = {
  mode: driveMode,
  ...(driveId ? { driveId } : {}),
  rootFolderId: required("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
};

const storageOptions: GoogleDriveMediaStorageOptions =
  authMode === "oauth"
    ? {
        ...base,
        authMode: "oauth",
        oauthClientId: required("GOOGLE_OAUTH_CLIENT_ID"),
        oauthClientSecret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
        oauthRefreshToken: required("GOOGLE_OAUTH_REFRESH_TOKEN"),
      }
    : {
        ...base,
        authMode: "service-account",
        serviceAccountEmail: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
        privateKey: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
      };

async function main() {
  const storage = new GoogleDriveMediaStorage(storageOptions);
  await storage.verifyConnection();

  const result = await withPreparedMediaAsset({
    mediaAssetId,
    storage,
    database: prisma,
    toolchain: {
      ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
    },
    consume: async (workspace) => {
      const frameStats = await Promise.all(
        workspace.frames.map(async (frame) => ({
          index: frame.index,
          timestampMs: frame.timestampMs,
          bytes: (await stat(frame.path)).size,
        })),
      );
      const audioBytes = workspace.audioPath
        ? (await stat(workspace.audioPath)).size
        : null;

      let inspectionOutputDir: string | null = null;
      if (outputDirArg) {
        inspectionOutputDir = resolve(outputDirArg);
        await mkdir(inspectionOutputDir, { recursive: true });
        for (const frame of workspace.frames) {
          await copyFile(
            frame.path,
            resolve(
              inspectionOutputDir,
              `frame-${String(frame.index + 1).padStart(2, "0")}.jpg`,
            ),
          );
        }
        if (workspace.audioPath) {
          await copyFile(
            workspace.audioPath,
            resolve(inspectionOutputDir, "audio-16khz-mono.wav"),
          );
        }
      }

      return {
        mediaAssetId: workspace.mediaAssetId,
        durationMs: workspace.probe.durationMs,
        frameCount: workspace.frames.length,
        frames: frameStats,
        hasNormalizedAudio: Boolean(workspace.audioPath),
        audioBytes,
        inspectionOutputDir,
      };
    },
  });

  console.log("[media:prepare] deterministic preparation complete");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("[media:prepare] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
