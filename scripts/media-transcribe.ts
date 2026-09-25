import OpenAI from "openai";
import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";
import {
  OpenAITranscriptionProvider,
  transcribeMediaAsset,
} from "../packages/media-intelligence/src/transcription.ts";
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
const language = positionalArgs[1]?.trim();
if (!mediaAssetId) {
  console.error(
    "Usage: npm run media:transcribe -- <media-asset-id> [language-code] [--force]",
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

  const client = new OpenAI({
    apiKey: required("GROQ_API_KEY"),
    baseURL: "https://api.groq.com/openai/v1",
  });

  const provider = new OpenAITranscriptionProvider(
    client,
    process.env.GROQ_TRANSCRIPTION_MODEL?.trim() || "whisper-large-v3-turbo",
  );

  const result = await transcribeMediaAsset({
    mediaAssetId,
    storage,
    database: prisma,
    toolchain: {
      ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
    },
    provider,
    ...(language ? { language } : {}),
    force,
  });

  console.log("[media:transcribe] transcription complete");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("[media:transcribe] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
