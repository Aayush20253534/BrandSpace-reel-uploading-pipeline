import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";
import { probeMedia } from "../packages/media-intelligence/src/index.ts";
import {
  renderReel,
  REEL_RENDER_PROFILE_VERSION,
  type RenderSource,
} from "../packages/reel-rendering/src/index.ts";
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

const reelVersionId = process.argv[2]?.trim();
const outputArg = process.argv[3]?.trim();
if (!reelVersionId || !outputArg) {
  console.error(
    "Usage: npm run reel:render -- <reel-version-id> <output-mp4-path>",
  );
  process.exit(1);
}

const driveMode = (process.env.GOOGLE_DRIVE_MODE ??
  "my-drive") as GoogleDriveMode;
const authMode = (process.env.GOOGLE_DRIVE_AUTH_MODE ??
  "service-account") as GoogleDriveAuthMode;
if (driveMode !== "my-drive" && driveMode !== "shared-drive")
  throw new Error("GOOGLE_DRIVE_MODE must be my-drive or shared-drive");
if (authMode !== "oauth" && authMode !== "service-account")
  throw new Error("GOOGLE_DRIVE_AUTH_MODE must be oauth or service-account");

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

const toolchain = {
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
};

async function main() {
  const version = await prisma.reelVersion.findUnique({
    where: { id: reelVersionId },
    select: {
      id: true,
      reelProjectId: true,
      version: true,
      reelProject: { select: { state: true } },
      sources: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          inMs: true,
          outMs: true,
          mediaAsset: {
            select: {
              id: true,
              driveFileId: true,
              name: true,
              mimeType: true,
            },
          },
        },
      },
    },
  });

  if (!version) throw new Error(`ReelVersion not found: ${reelVersionId}`);
  if (version.reelProject.state !== "PLANNED") {
    throw new Error(
      `ReelProject ${version.reelProjectId} must be PLANNED before rendering`,
    );
  }
  if (version.sources.length === 0)
    throw new Error("ReelVersion has no sources");

  const storage = new GoogleDriveMediaStorage(storageOptions);
  await storage.verifyConnection();
  const workDir = await mkdtemp(join(tmpdir(), "brandspace-render-"));
  const renderJob = await prisma.renderJob.create({
    data: {
      reelVersionId: version.id,
      state: "RUNNING",
      attemptCount: 1,
      startedAt: new Date(),
      input: {
        profileVersion: REEL_RENDER_PROFILE_VERSION,
        sourceCount: version.sources.length,
      },
    },
    select: { id: true },
  });

  await prisma.reelProject.update({
    where: { id: version.reelProjectId },
    data: { state: "RENDERING" },
  });

  try {
    const downloaded = new Map<string, { path: string; hasAudio: boolean }>();
    const sources: RenderSource[] = [];

    for (const source of version.sources) {
      if (source.inMs === null || source.outMs === null)
        throw new Error(
          `ReelSource ${source.order} is missing clip boundaries`,
        );

      let local = downloaded.get(source.mediaAsset.id);
      if (!local) {
        const extension = extname(source.mediaAsset.name) || ".mp4";
        const path = join(workDir, `${source.mediaAsset.id}${extension}`);
        await storage.downloadToFile(source.mediaAsset.driveFileId, path);
        const probe = await probeMedia(path, toolchain);
        if (!probe.hasVideo)
          throw new Error(`MediaAsset ${source.mediaAsset.id} has no video`);
        local = { path, hasAudio: probe.hasAudio };
        downloaded.set(source.mediaAsset.id, local);
      }

      sources.push({
        path: local.path,
        startMs: source.inMs,
        endMs: source.outMs,
        hasAudio: local.hasAudio,
      });
    }

    const outputPath = resolve(outputArg);
    const result = await renderReel({
      sources,
      outputPath,
      ffmpegPath: toolchain.ffmpegPath,
    });
    const probe = await probeMedia(outputPath, toolchain);

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: {
        state: "SUCCEEDED",
        completedAt: new Date(),
        output: {
          ...result,
          width: probe.width,
          height: probe.height,
          durationMs: probe.durationMs,
          hasVideo: probe.hasVideo,
          hasAudio: probe.hasAudio,
        },
      },
    });

    console.log("[reel:render] deterministic render complete");
    console.log(
      JSON.stringify(
        {
          renderJobId: renderJob.id,
          reelProjectId: version.reelProjectId,
          reelVersionId: version.id,
          version: version.version,
          ...result,
          probe,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown render error";
    await Promise.allSettled([
      prisma.renderJob.update({
        where: { id: renderJob.id },
        data: {
          state: "FAILED",
          errorCode:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "RENDER_FAILED",
          errorMessage: message.slice(0, 4000),
          completedAt: new Date(),
        },
      }),
      prisma.reelProject.update({
        where: { id: version.reelProjectId },
        data: { state: "RENDER_FAILED" },
      }),
    ]);
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main()
  .catch((error: unknown) => {
    console.error("[reel:render] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
