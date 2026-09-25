import { loadEnvFile } from "node:process";
import { GoogleDriveMediaStorage } from "../packages/storage/src/index.ts";

loadEnvFile(".env");

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const mode = process.env.GOOGLE_DRIVE_MODE ?? "my-drive";
if (mode !== "my-drive" && mode !== "shared-drive") {
  throw new Error("GOOGLE_DRIVE_MODE must be my-drive or shared-drive");
}

const driveId = process.env.GOOGLE_DRIVE_ID?.trim() || undefined;
if (mode === "shared-drive" && !driveId) {
  throw new Error("GOOGLE_DRIVE_ID is required in shared-drive mode");
}

const storage = new GoogleDriveMediaStorage({
  mode,
  ...(driveId ? { driveId } : {}),
  rootFolderId: required("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
  serviceAccountEmail: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  privateKey: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
});

async function main() {
  console.log(`[drive] mode: ${mode}`);

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
