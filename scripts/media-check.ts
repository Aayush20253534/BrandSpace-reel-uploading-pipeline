import { loadEnvFile } from "node:process";
import { verifyMediaToolchain } from "../packages/media-intelligence/src/index.ts";

loadEnvFile(".env");

const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";

verifyMediaToolchain({ ffmpegPath, ffprobePath })
  .then((versions) => {
    console.log("[media] FFmpeg toolchain: OK");
    console.log(versions.ffmpeg);
    console.log(versions.ffprobe);
  })
  .catch((error: unknown) => {
    console.error("[media] FFmpeg toolchain: FAILED");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
