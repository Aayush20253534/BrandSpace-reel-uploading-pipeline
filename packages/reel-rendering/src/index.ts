import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

export const REEL_RENDER_PROFILE_VERSION = "reel-render-v1" as const;

export interface RenderSource {
  path: string;
  startMs: number;
  endMs: number;
  hasAudio: boolean;
}

export interface ReelRenderProfile {
  width: number;
  height: number;
  fps: number;
  videoCodec: "libx264";
  audioCodec: "aac";
  videoCrf: number;
  audioBitrate: string;
}

export const DEFAULT_REEL_RENDER_PROFILE: ReelRenderProfile = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: "libx264",
  audioCodec: "aac",
  videoCrf: 20,
  audioBitrate: "192k",
};

export class ReelRenderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stderr?: string,
  ) {
    super(message);
    this.name = "ReelRenderError";
  }
}

export function validateRenderSources(sources: RenderSource[]): RenderSource[] {
  if (sources.length === 0) {
    throw new ReelRenderError(
      "At least one source clip is required",
      "RENDER_SOURCES_EMPTY",
    );
  }
  for (const [index, source] of sources.entries()) {
    if (
      !source.path ||
      !Number.isInteger(source.startMs) ||
      !Number.isInteger(source.endMs) ||
      source.startMs < 0 ||
      source.endMs <= source.startMs
    ) {
      throw new ReelRenderError(
        `Invalid source clip at index ${index}`,
        "RENDER_SOURCE_INVALID",
      );
    }
  }
  return sources;
}

export function buildRenderArguments(input: {
  sources: RenderSource[];
  outputPath: string;
  profile?: ReelRenderProfile;
}): string[] {
  const sources = validateRenderSources(input.sources);
  const profile = input.profile ?? DEFAULT_REEL_RENDER_PROFILE;
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];

  for (const source of sources) args.push("-i", source.path);

  const filters: string[] = [];
  const concatInputs: string[] = [];

  sources.forEach((source, index) => {
    const start = (source.startMs / 1000).toFixed(3);
    const end = (source.endMs / 1000).toFixed(3);
    const duration = ((source.endMs - source.startMs) / 1000).toFixed(3);

    filters.push(
      `[${index}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,` +
        `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase,` +
        `crop=${profile.width}:${profile.height},fps=${profile.fps},format=yuv420p[v${index}]`,
    );

    if (source.hasAudio) {
      filters.push(
        `[${index}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,` +
          `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`,
      );
    } else {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
      );
    }

    concatInputs.push(`[v${index}][a${index}]`);
  });

  filters.push(
    `${concatInputs.join("")}concat=n=${sources.length}:v=1:a=1[vout][aout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    profile.videoCodec,
    "-preset",
    "medium",
    "-crf",
    String(profile.videoCrf),
    "-c:a",
    profile.audioCodec,
    "-b:a",
    profile.audioBitrate,
    "-movflags",
    "+faststart",
    input.outputPath,
  );

  return args;
}

async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr, "utf8") > MAX_CAPTURE_BYTES) {
        child.kill();
        finish(
          new ReelRenderError(
            "FFmpeg stderr exceeded capture limit",
            "RENDER_TOOL_OUTPUT_LIMIT",
          ),
        );
      }
    });

    child.once("error", (error) =>
      finish(
        new ReelRenderError(
          `Unable to start FFmpeg: ${error.message}`,
          "RENDER_TOOL_NOT_FOUND",
        ),
      ),
    );
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code === 0) return finish();
      finish(
        new ReelRenderError(
          `FFmpeg render failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}`,
          "RENDER_TOOL_FAILED",
          stderr.slice(-4000),
        ),
      );
    });

    const timer = setTimeout(() => {
      child.kill();
      finish(
        new ReelRenderError(
          `FFmpeg render exceeded ${timeoutMs}ms timeout`,
          "RENDER_TOOL_TIMEOUT",
          stderr.slice(-4000),
        ),
      );
    }, timeoutMs);
  });
}

export async function renderReel(input: {
  sources: RenderSource[];
  outputPath: string;
  ffmpegPath?: string;
  timeoutMs?: number;
  profile?: ReelRenderProfile;
}): Promise<{
  outputPath: string;
  sizeBytes: number;
  expectedDurationMs: number;
  profileVersion: typeof REEL_RENDER_PROFILE_VERSION;
}> {
  await mkdir(dirname(input.outputPath), { recursive: true });
  const args = buildRenderArguments({
    sources: input.sources,
    outputPath: input.outputPath,
    ...(input.profile ? { profile: input.profile } : {}),
  });

  await runFfmpeg(
    input.ffmpegPath ?? "ffmpeg",
    args,
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const output = await stat(input.outputPath);
  if (!output.isFile() || output.size <= 0) {
    throw new ReelRenderError(
      "FFmpeg completed without a usable output file",
      "RENDER_OUTPUT_EMPTY",
    );
  }

  return {
    outputPath: input.outputPath,
    sizeBytes: output.size,
    expectedDurationMs: input.sources.reduce(
      (total, source) => total + source.endMs - source.startMs,
      0,
    ),
    profileVersion: REEL_RENDER_PROFILE_VERSION,
  };
}
