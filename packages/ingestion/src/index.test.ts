import assert from "node:assert/strict";
import test from "node:test";
import type { MediaObject } from "@forge/storage";
import { ingestClientDriveFolder } from "./index";

const folder: MediaObject = {
  id: "client-folder",
  name: "Client",
  mimeType: "application/vnd.google-apps.folder",
};

const video: MediaObject = {
  id: "video-1",
  name: "launch.mp4",
  mimeType: "video/mp4",
  sizeBytes: 42,
  checksum: "abc",
  revisionId: "7",
  parentIds: ["client-folder"],
};

test("full scan is idempotent and skips non-media", async () => {
  const assets = new Map<string, any>();
  let syncState: any = null;

  const database = {
    client: {
      findUnique: async () => ({
        id: "client-1",
        driveFolderId: "client-folder",
      }),
    },
    mediaAsset: {
      findUnique: async ({ where }: any) =>
        assets.get(where.clientId_driveFileId.driveFileId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const key = where.clientId_driveFileId.driveFileId;
        const previous = assets.get(key);
        const value = previous ? { ...previous, ...update } : create;
        assets.set(key, value);
        return value;
      },
    },
    driveSyncState: {
      upsert: async ({ create, update }: any) => {
        syncState = syncState ? update : create;
        return syncState;
      },
    },
  };

  const storage = {
    getMetadata: async () => folder,
    listChildren: async () => [
      video,
      {
        id: "nested",
        name: "nested",
        mimeType: "application/vnd.google-apps.folder",
      },
      {
        id: "doc",
        name: "notes",
        mimeType: "application/vnd.google-apps.document",
      },
    ],
    getStartPageToken: async () => "token-1",
    downloadToFile: async () => undefined,
    uploadFromFile: async () => video,
  };

  const first = await ingestClientDriveFolder({
    clientId: "client-1",
    database: database as any,
    storage,
  });
  assert.equal(first.created, 1);
  assert.equal(first.updated, 0);
  assert.equal(first.skippedFolders, 1);
  assert.equal(first.skippedUnsupported, 1);
  assert.equal(assets.size, 1);
  assert.equal(assets.get("video-1").kind, "RAW_VIDEO");
  assert.equal(assets.get("video-1").state, "READY");
  assert.equal(syncState.startPageToken, "token-1");

  const second = await ingestClientDriveFolder({
    clientId: "client-1",
    database: database as any,
    storage,
  });
  assert.equal(second.created, 0);
  assert.equal(second.updated, 1);
  assert.equal(assets.size, 1);
});
