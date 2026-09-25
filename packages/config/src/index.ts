import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalUrl = z.preprocess(
  emptyStringToUndefined,
  z.string().url().optional(),
);

const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().min(1).optional(),
);

const optionalEmail = z.preprocess(
  emptyStringToUndefined,
  z.string().email().optional(),
);

const optionalSecret = z.preprocess(
  emptyStringToUndefined,
  z.string().min(32).optional(),
);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  APP_URL: z.string().url().default("http://localhost:3000"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: optionalUrl,

  BETTER_AUTH_SECRET: optionalSecret,

  BETTER_AUTH_URL: optionalUrl,

  REDIS_URL: optionalUrl,

  SOCIAL_TOKEN_ENCRYPTION_KEY: optionalString,

  GOOGLE_DRIVE_MODE: z.enum(["my-drive", "shared-drive"]).default("my-drive"),

  GOOGLE_DRIVE_AUTH_MODE: z
    .enum(["oauth", "service-account"])
    .default("service-account"),

  GOOGLE_DRIVE_ID: optionalString,

  GOOGLE_DRIVE_ROOT_FOLDER_ID: optionalString,

  GOOGLE_OAUTH_CLIENT_ID: optionalString,

  GOOGLE_OAUTH_CLIENT_SECRET: optionalString,

  GOOGLE_OAUTH_REFRESH_TOKEN: optionalString,

  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalEmail,

  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: optionalString,
});

const result = schema.safeParse(process.env);

if (!result.success) {
  const fields = result.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");

  throw new Error(`Invalid environment configuration: ${fields}`);
}

if (
  result.data.NODE_ENV === "production" &&
  result.data.BETTER_AUTH_SECRET ===
    "replace-with-at-least-32-random-characters"
) {
  throw new Error("BETTER_AUTH_SECRET must be replaced in production");
}

export const env = Object.freeze(result.data);
