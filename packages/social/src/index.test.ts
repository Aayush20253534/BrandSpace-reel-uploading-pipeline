import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  assertSocialAccountSchedulable,
  decryptSocialToken,
  encryptSocialToken,
  parseSocialTokenEncryptionKey,
} from "./index";

const key = () => randomBytes(32).toString("base64url");

test("social tokens round-trip through authenticated encryption", () => {
  const encodedKey = key();
  const first = encryptSocialToken("ig-secret-token", encodedKey);
  const second = encryptSocialToken("ig-secret-token", encodedKey);

  assert.notEqual(first, second);
  assert.equal(decryptSocialToken(first, encodedKey), "ig-secret-token");
  assert.equal(decryptSocialToken(second, encodedKey), "ig-secret-token");
});

test("social token ciphertext rejects the wrong key", () => {
  const encrypted = encryptSocialToken("ig-secret-token", key());
  assert.throws(() => decryptSocialToken(encrypted, key()));
});

test("social token encryption keys must decode to exactly 32 bytes", () => {
  assert.throws(() =>
    parseSocialTokenEncryptionKey(randomBytes(16).toString("base64url")),
  );
});

test("schedulable accounts enforce tenant, status, credential and expiry", () => {
  const base = {
    id: "social-1",
    clientId: "client-a",
    platform: "INSTAGRAM",
    status: "CONNECTED",
    accessTokenCiphertext: "v1.fake.fake.fake",
    tokenExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
  };

  assert.doesNotThrow(() =>
    assertSocialAccountSchedulable(
      base,
      "client-a",
      new Date("2026-09-25T00:00:00.000Z"),
    ),
  );

  assert.throws(() =>
    assertSocialAccountSchedulable(
      { ...base, clientId: "client-b" },
      "client-a",
    ),
  );
  assert.throws(() =>
    assertSocialAccountSchedulable({ ...base, status: "PENDING" }, "client-a"),
  );
  assert.throws(() =>
    assertSocialAccountSchedulable(
      { ...base, accessTokenCiphertext: null },
      "client-a",
    ),
  );
  assert.throws(() =>
    assertSocialAccountSchedulable(
      { ...base, tokenExpiresAt: new Date("2026-09-01T00:00:00.000Z") },
      "client-a",
      new Date("2026-09-25T00:00:00.000Z"),
    ),
  );
});
