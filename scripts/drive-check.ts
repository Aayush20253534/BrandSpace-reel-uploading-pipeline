import { loadEnvFile } from "node:process";
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
if (driveMode === "shared-drive" && !driveId) {
  throw new Error("GOOGLE_DRIVE_ID is required in shared-drive mode");
}

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

const storage = new GoogleDriveMediaStorage(options);

async function main() {
  console.log(`[drive] mode: ${driveMode}`);
  console.log(`[drive] auth: ${authMode}`);

  await storage.verifyConnection();
  console.log("[drive] authentication/root folder: OK");

  const children = await storage.listChildren(storage.rootFolderId);
  console.log(`[drive] root listing: OK (${children.length} item(s))`);

  const token = await storage.getStartPageToken();
  if (!token) {
    throw new Error("Drive did not return a start page token");
  }

  console.log("[drive] change tracking: OK");
  console.log("[drive] verification passed");
}

main().catch((error: unknown) => {
  console.error("[drive] verification failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
