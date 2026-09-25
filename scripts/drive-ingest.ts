import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";
import { ingestClientDriveFolder } from "../packages/ingestion/src/index.ts";
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

const clientId = process.argv[2]?.trim();
if (!clientId) {
  console.error("Usage: npm run drive:ingest -- <client-id>");
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

const options: GoogleDriveMediaStorageOptions =
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
  const storage = new GoogleDriveMediaStorage(options);
  await storage.verifyConnection();

  const summary = await ingestClientDriveFolder({
    clientId,
    storage,
    database: prisma,
  });

  console.log("[drive:ingest] full scan complete");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("[drive:ingest] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
