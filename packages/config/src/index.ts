import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: optionalUrl,
  REDIS_URL: optionalUrl,
  GOOGLE_DRIVE_ID: z.string().min(1).optional(),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(1).optional(),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid environment configuration: ${fields}`);
}

export const env = Object.freeze(result.data);
