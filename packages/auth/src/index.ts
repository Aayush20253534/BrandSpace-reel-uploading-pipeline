import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@forge/database";
import { env } from "@forge/config";

const secret =
  env.BETTER_AUTH_SECRET ??
  (env.NODE_ENV === "production"
    ? undefined
    : "brandspace-forge-development-secret-change-me");

if (!secret) {
  throw new Error("BETTER_AUTH_SECRET is required in production");
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL ?? env.APP_URL,
  secret,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
});
