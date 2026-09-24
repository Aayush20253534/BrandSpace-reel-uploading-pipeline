import { env } from "@forge/config";
import { createLogger } from "@forge/logger";
import { APP_NAME, PHASE } from "@forge/shared";

const logger = createLogger("worker");

logger.info("worker_started", {
  app: APP_NAME,
  phase: PHASE,
  environment: env.NODE_ENV,
});

const shutdown = (signal: string) => {
  logger.info("worker_stopping", { signal });
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
