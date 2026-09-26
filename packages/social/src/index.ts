import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_FORMAT_VERSION = "v1";
const TOKEN_AAD = Buffer.from("brandspace-forge:social-token:v1", "utf8");
const AES_256_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;

export const INSTAGRAM_PUBLISHING_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
] as const;

export interface SchedulableSocialAccount {
  id: string;
  clientId: string;
  platform: string;
  status: string;
  accessTokenCiphertext: string | null;
  tokenExpiresAt: Date | null;
}

export function parseSocialTokenEncryptionKey(encoded: string) {
  const value = encoded.trim();
  if (!value) {
    throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY is required");
  }

  let key: Buffer;
  try {
    key = Buffer.from(value, "base64url");
  } catch {
    throw new Error(
      "SOCIAL_TOKEN_ENCRYPTION_KEY must be a base64url-encoded 32-byte key",
    );
  }

  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error(
      "SOCIAL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  }

  return key;
}

export function encryptSocialToken(token: string, encodedKey: string) {
  const plaintext = token.trim();
  if (!plaintext) {
    throw new Error("Social access token must not be empty");
  }

  const key = parseSocialTokenEncryptionKey(encodedKey);
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(TOKEN_AAD);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_FORMAT_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSocialToken(payload: string, encodedKey: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] =
    payload.split(".");

  if (
    version !== TOKEN_FORMAT_VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra !== undefined
  ) {
    throw new Error("Unsupported social token ciphertext format");
  }

  const key = parseSocialTokenEncryptionKey(encodedKey);
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");

  if (iv.length !== GCM_IV_BYTES) {
    throw new Error("Invalid social token IV");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(TOKEN_AAD);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function parseSocialTokenPreviousKeys(
  value: string | undefined,
  currentKey: string,
) {
  parseSocialTokenEncryptionKey(currentKey);
  const keys =
    value
      ?.split(",")
      .map((key) => key.trim())
      .filter(Boolean) ?? [];
  if (
    keys.length > 3 ||
    new Set([currentKey.trim(), ...keys]).size !== keys.length + 1
  ) {
    throw new Error(
      "Social token previous keys must be distinct and limited to three",
    );
  }
  for (const key of keys) parseSocialTokenEncryptionKey(key);
  return keys;
}

export function decryptSocialTokenFromKeyring(
  payload: string,
  currentKey: string,
  previousKeys: readonly string[] = [],
) {
  for (const [keyIndex, key] of [currentKey, ...previousKeys].entries()) {
    try {
      return { plaintext: decryptSocialToken(payload, key), keyIndex };
    } catch {
      // The ciphertext does not identify its encryption key. Try only the
      // explicitly configured keys and never expose crypto exception details.
    }
  }
  throw new Error("Social token cannot be decrypted with configured keys");
}

export function assertSocialAccountSchedulable(
  account: SchedulableSocialAccount,
  expectedClientId: string,
  now = new Date(),
) {
  if (account.clientId !== expectedClientId) {
    throw new Error(
      `SocialAccount ${account.id} is outside the ReelProject client`,
    );
  }
  if (account.platform !== "INSTAGRAM") {
    throw new Error(`SocialAccount ${account.id} is not an Instagram account`);
  }
  if (account.status !== "CONNECTED") {
    throw new Error(
      `SocialAccount ${account.id} must be CONNECTED before scheduling`,
    );
  }
  if (!account.accessTokenCiphertext) {
    throw new Error(`SocialAccount ${account.id} has no stored credential`);
  }
  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() <= now.getTime()
  ) {
    throw new Error(`SocialAccount ${account.id} credential has expired`);
  }
}

export * from "./instagram.js";
