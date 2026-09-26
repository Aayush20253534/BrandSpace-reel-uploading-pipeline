import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCanonicalMediaMatches,
  assertGeneratedReelAsset,
  publicationObjectKey,
} from "./publication-media.js";

const asset = {
  id: "asset-a",
  clientId: "client-a",
  driveFileId: "drive-a",
  driveRevisionId: "7",
  checksum: "checksum-a",
  kind: "GENERATED_REEL",
  state: "READY",
  mimeType: "video/mp4",
  sizeBytes: 123n,
  metadata: { generatedBy: "reel.render", reelVersionId: "version-a" },
};

test("only a matching generated reel can be delivered", () => {
  assert.doesNotThrow(() =>
    assertGeneratedReelAsset(asset, "client-a", "version-a"),
  );
  assert.throws(() => assertGeneratedReelAsset(asset, "client-b", "version-a"));
  assert.throws(() => assertGeneratedReelAsset(asset, "client-a", "version-b"));
  assert.throws(() =>
    assertGeneratedReelAsset(
      { ...asset, kind: "RAW_VIDEO" },
      "client-a",
      "version-a",
    ),
  );
  assert.throws(() =>
    assertGeneratedReelAsset(
      { ...asset, sizeBytes: 0n },
      "client-a",
      "version-a",
    ),
  );
});

test("canonical object must still match the durable artifact", () => {
  const canonical = {
    id: "drive-a",
    name: "reel.mp4",
    mimeType: "video/mp4",
    sizeBytes: 123,
    revisionId: "7",
    checksum: "checksum-a",
  };
  assert.doesNotThrow(() => assertCanonicalMediaMatches(asset, canonical));
  assert.throws(() =>
    assertCanonicalMediaMatches(asset, { ...canonical, revisionId: "8" }),
  );
  assert.throws(() =>
    assertCanonicalMediaMatches(asset, { ...canonical, sizeBytes: 124 }),
  );
  assert.throws(() =>
    assertCanonicalMediaMatches(asset, {
      ...canonical,
      checksum: "checksum-b",
    }),
  );
});

test("object keys are deterministic and isolated per job and client", () => {
  const input = {
    clientId: "client-a",
    publishingJobId: "job-a",
    mediaAssetId: "asset-a",
    driveRevisionId: "7",
  };
  assert.equal(publicationObjectKey(input), publicationObjectKey(input));
  assert.notEqual(
    publicationObjectKey(input),
    publicationObjectKey({ ...input, clientId: "client-b" }),
  );
  assert.notEqual(
    publicationObjectKey(input),
    publicationObjectKey({ ...input, publishingJobId: "job-b" }),
  );
});
