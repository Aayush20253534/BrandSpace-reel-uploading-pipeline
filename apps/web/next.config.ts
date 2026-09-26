import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

function findRepositoryEnv(startDirectory: string) {
  let currentDirectory = resolve(startDirectory);

  for (;;) {
    const candidate = resolve(currentDirectory, ".env");
    if (existsSync(candidate)) return candidate;

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
}

const rootEnvPath =
  findRepositoryEnv(process.env.INIT_CWD ?? process.cwd()) ??
  findRepositoryEnv(process.cwd());

if (rootEnvPath) {
  loadEnvFile(rootEnvPath);
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@forge/queue", "bullmq", "ioredis"],
};

export default nextConfig;
