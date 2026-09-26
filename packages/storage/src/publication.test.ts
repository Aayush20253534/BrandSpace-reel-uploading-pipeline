import assert from "node:assert/strict";
import { test } from "node:test";
import {
  S3TemporaryMediaDelivery,
  validateS3TemporaryMediaDeliveryOptions,
} from "./publication.js";

const options = {
  endpoint: "https://example.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "publication",
  accessKeyId: "access",
  secretAccessKey: "secret",
};

test("publication endpoint is a bare HTTPS origin", () => {
  assert.doesNotThrow(() => validateS3TemporaryMediaDeliveryOptions(options));
  assert.throws(() =>
    validateS3TemporaryMediaDeliveryOptions({
      ...options,
      endpoint: "http://example.com",
    }),
  );
  assert.throws(() =>
    validateS3TemporaryMediaDeliveryOptions({
      ...options,
      endpoint: "https://user:pass@example.com",
    }),
  );
  assert.throws(() =>
    validateS3TemporaryMediaDeliveryOptions({
      ...options,
      endpoint: "https://example.com/unsafe/path",
    }),
  );
});

test("signed read URLs are scoped to one private object and expire", async () => {
  const delivery = new S3TemporaryMediaDelivery(options);
  const url = new URL(
    await delivery.signedReadUrl("publication/ab/reel.mp4", 900),
  );
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "example.r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/publication/publication/ab/reel.mp4");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  await assert.rejects(() => delivery.signedReadUrl("key", 86_401));
});
