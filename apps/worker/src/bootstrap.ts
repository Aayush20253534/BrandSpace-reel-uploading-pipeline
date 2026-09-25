import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const rootEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

// @forge/config validates process.env when the worker module is evaluated.
// Import only after the repository .env has been loaded.
await import("./index.js");
