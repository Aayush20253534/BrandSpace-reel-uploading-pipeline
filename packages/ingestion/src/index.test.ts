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
    createFolder: async () => folder,
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

test("full scan preserves analyzed state for unchanged media and resets changed source metadata", async () => {
  const asset = {
    id: "asset-1",
    clientId: "client-1",
    driveFileId: video.id,
    driveRevisionId: "7",
    checksum: "abc",
    sizeBytes: 42n,
    state: "ANALYZED",
    durationMs: 4_000,
    width: 1080,
    height: 1920,
    metadata: { technical: { analyzer: "ffprobe" } },
  };
  let current: any = asset;
  let source: MediaObject = video;
  const database = {
    client: {
      findUnique: async () => ({ id: "client-1", driveFolderId: folder.id }),
    },
    mediaAsset: {
      findUnique: async () => current,
      upsert: async ({ update }: any) => {
        current = { ...current, ...update };
        return current;
      },
    },
    driveSyncState: { upsert: async () => ({}) },
  };
  const storage = {
    getMetadata: async () => folder,
    listChildren: async () => [source],
    getStartPageToken: async () => "token-1",
  };

  await ingestClientDriveFolder({
    clientId: "client-1",
    database: database as any,
    storage: storage as any,
  });
  assert.equal(current.state, "ANALYZED");
  assert.equal(current.durationMs, 4_000);
  assert.equal(current.metadata.technical.analyzer, "ffprobe");

  source = { ...video, revisionId: "8", checksum: "def" };
  await ingestClientDriveFolder({
    clientId: "client-1",
    database: database as any,
    storage: storage as any,
  });
  assert.equal(current.state, "READY");
  assert.equal(current.durationMs, null);
  assert.equal(current.width, null);
  assert.equal(current.height, null);
  assert.equal(current.metadata.technical, undefined);
});
