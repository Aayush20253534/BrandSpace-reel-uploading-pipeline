import OpenAI from "openai";
import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";
import {
  OpenAISemanticAnalysisProvider,
  understandMediaAsset,
} from "../packages/media-intelligence/src/semantic.ts";
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

const args = process.argv.slice(2);
const force = args.includes("--force");
const positionalArgs = args.filter((arg) => arg !== "--force");
const mediaAssetId = positionalArgs[0]?.trim();
if (!mediaAssetId) {
  console.error(
    "Usage: npm run media:understand -- <media-asset-id> [--force]",
  );
  process.exit(1);
}

const driveMode = (process.env.GOOGLE_DRIVE_MODE ??
  "my-drive") as GoogleDriveMode;
const authMode = (process.env.GOOGLE_DRIVE_AUTH_MODE ??
  "service-account") as GoogleDriveAuthMode;
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

  const client = new OpenAI({
    apiKey: required("GROQ_API_KEY"),
    baseURL: "https://api.groq.com/openai/v1",
  });
  const provider = new OpenAISemanticAnalysisProvider(
    client,
    process.env.GROQ_VISION_MODEL?.trim() || "qwen/qwen3.8-27b",
  );

  const result = await understandMediaAsset({
    mediaAssetId,
    storage,
    database: prisma,
    toolchain: {
      ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
    },
    provider,
    force,
  });

  console.log("[media:understand] semantic analysis complete");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("[media:understand] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
