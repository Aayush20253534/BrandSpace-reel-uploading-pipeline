import OpenAI from "openai";
import { loadEnvFile } from "node:process";
import { prisma } from "../packages/database/src/index.ts";
import { GroqReelPlanningProvider } from "../packages/reel-planning/src/groq.ts";
import { planReelProject } from "../packages/reel-planning/src/index.ts";

loadEnvFile(".env");

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const reelProjectId = process.argv[2]?.trim();
if (!reelProjectId) {
  console.error("Usage: npm run reel:plan -- <reel-project-id>");
  process.exit(1);
}

async function main() {
  const client = new OpenAI({
    apiKey: required("GROQ_API_KEY"),
    baseURL: "https://api.groq.com/openai/v1",
  });
  const provider = new GroqReelPlanningProvider(
    client,
    process.env.GROQ_REEL_PLANNING_MODEL?.trim() || "qwen/qwen3.8-27b",
  );

  const result = await planReelProject({
    reelProjectId,
    database: prisma,
    provider,
  });

  console.log("[reel:plan] reel planning complete");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("[reel:plan] failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
