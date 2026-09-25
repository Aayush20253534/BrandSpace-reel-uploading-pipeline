import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Prisma, type PrismaClient } from "@forge/database";
import type { MediaStorage } from "@forge/storage";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

export interface MediaToolchain {
  ffmpegPath: string;
  ffprobePath: string;
}

export interface MediaProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  formatName: string | null;
  bitRate: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface MediaPreprocessSummary {
  mediaAssetId: string;
  analysisId: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface MediaIntelligenceDatabase {
  mediaAsset: Pick<PrismaClient["mediaAsset"], "findUnique" | "update">;
  mediaAnalysis: Pick<
    PrismaClient["mediaAnalysis"],
    "create" | "findFirst" | "update"
  >;
}

type ProbeJson = {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
  }>;
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
  };
};

export class MediaToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stderr?: string,
  ) {
    super(message);
    this.name = "MediaToolError";
  }
}

const finiteNumber = (value: unknown): number | null => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
};

const parseRate = (value: string | undefined): number | null => {
  if (!value) return null;
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = finiteNumber(numeratorRaw);
  const denominator = finiteNumber(denominatorRaw ?? "1");
  if (numerator === null || denominator === null || denominator === 0)
    return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
};

const safeInt = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : null;
};

async function runCaptured(
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };

    const append = (
      current: string,
      chunk: Buffer,
      streamName: "stdout" | "stderr",
    ) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > MAX_CAPTURE_BYTES) {
        child.kill();
        finish(
          new MediaToolError(
            `${command} ${streamName} exceeded capture limit`,
            "MEDIA_TOOL_OUTPUT_LIMIT",
          ),
        );
      }
      return next;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk, "stdout");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk, "stderr");
    });

    child.once("error", (error) => {
      finish(
        new MediaToolError(
          `Unable to start ${command}: ${error.message}`,
          "MEDIA_TOOL_NOT_FOUND",
        ),
      );
    });

    child.once("close", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new MediaToolError(
          `${command} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}`,
          "MEDIA_TOOL_FAILED",
          stderr.slice(-4000),
        ),
      );
    });

    const timer = setTimeout(() => {
      child.kill();
      finish(
        new MediaToolError(
          `${command} exceeded ${timeoutMs}ms timeout`,
          "MEDIA_TOOL_TIMEOUT",
          stderr.slice(-4000),
        ),
      );
    }, timeoutMs);
  });
}

export async function verifyMediaToolchain(
  toolchain: MediaToolchain,
): Promise<{ ffmpeg: string; ffprobe: string }> {
  const [ffmpeg, ffprobe] = await Promise.all([
    runCaptured(toolchain.ffmpegPath, ["-version"], 15_000),
    runCaptured(toolchain.ffprobePath, ["-version"], 15_000),
  ]);

  return {
    ffmpeg: ffmpeg.stdout.split(/\r?\n/, 1)[0] ?? "",
    ffprobe: ffprobe.stdout.split(/\r?\n/, 1)[0] ?? "",
  };
}

export async function probeMedia(
  filePath: string,
  toolchain: MediaToolchain,
): Promise<MediaProbeResult> {
  const { stdout } = await runCaptured(toolchain.ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  let parsed: ProbeJson;
  try {
    parsed = JSON.parse(stdout) as ProbeJson;
  } catch {
    throw new MediaToolError(
      "ffprobe returned invalid JSON",
      "FFPROBE_INVALID_JSON",
    );
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds =
    finiteNumber(parsed.format?.duration) ??
    finiteNumber(video?.duration) ??
    finiteNumber(audio?.duration);
  const bitRate = finiteNumber(parsed.format?.bit_rate);

  return {
    durationMs:
      durationSeconds === null ? null : safeInt(durationSeconds * 1000),
    width: safeInt(finiteNumber(video?.width)),
    height: safeInt(finiteNumber(video?.height)),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    frameRate: parseRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    formatName: parsed.format?.format_name ?? null,
    bitRate: safeInt(bitRate),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

const extensionFor = (name: string, mimeType: string) => {
  const existing = extname(name);
  if (existing) return existing;
  if (mimeType === "video/mp4") return ".mp4";
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ".wav";
  return ".bin";
};

const technicalMetadata = (
  existing: Prisma.JsonValue | null,
  probe: MediaProbeResult,
): Prisma.InputJsonValue => {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Prisma.JsonObject)
      : {};

  return {
    ...base,
    technical: {
      analyzer: "ffprobe",
      analyzedAt: new Date().toISOString(),
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      frameRate: probe.frameRate,
      formatName: probe.formatName,
      bitRate: probe.bitRate,
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
    },
  };
};

export async function preprocessMediaAsset(input: {
  mediaAssetId: string;
  storage: MediaStorage;
  database: MediaIntelligenceDatabase;
  toolchain: MediaToolchain;
}): Promise<MediaPreprocessSummary> {
  const asset = await input.database.mediaAsset.findUnique({
    where: { id: input.mediaAssetId },
    select: {
      id: true,
      driveFileId: true,
      name: true,
      mimeType: true,
      kind: true,
      state: true,
      metadata: true,
    },
  });

  if (!asset) throw new Error(`MediaAsset not found: ${input.mediaAssetId}`);
  if (!["RAW_VIDEO", "AUDIO"].includes(asset.kind)) {
    throw new Error(
      `MediaAsset ${asset.id} kind ${asset.kind} is not supported yet`,
    );
  }

  const existingAnalysis = await input.database.mediaAnalysis.findFirst({
    where: { mediaAssetId: asset.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const startedAt = new Date();
  const analysis = existingAnalysis
    ? await input.database.mediaAnalysis.update({
        where: { id: existingAnalysis.id },
        data: {
          state: "RUNNING",
          errorCode: null,
          errorMessage: null,
          startedAt,
          completedAt: null,
        },
        select: { id: true },
      })
    : await input.database.mediaAnalysis.create({
        data: {
          mediaAssetId: asset.id,
          state: "RUNNING",
          tags: [],
          subjects: [],
          startedAt,
        },
        select: { id: true },
      });

  await input.database.mediaAsset.update({
    where: { id: asset.id },
    data: { state: "ANALYZING" },
  });

  const workDir = await mkdtemp(join(tmpdir(), "brandspace-media-"));
  const sourcePath = join(
    workDir,
    `source${extensionFor(asset.name, asset.mimeType)}`,
  );

  try {
    await input.storage.downloadToFile(asset.driveFileId, sourcePath);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size <= 0) {
      throw new MediaToolError(
        "Downloaded media is empty or not a regular file",
        "MEDIA_DOWNLOAD_INVALID",
      );
    }

    const probe = await probeMedia(sourcePath, input.toolchain);
    if (asset.kind === "RAW_VIDEO" && !probe.hasVideo) {
      throw new MediaToolError(
        "Expected a video stream but ffprobe found none",
        "VIDEO_STREAM_MISSING",
      );
    }
    if (asset.kind === "AUDIO" && !probe.hasAudio) {
      throw new MediaToolError(
        "Expected an audio stream but ffprobe found none",
        "AUDIO_STREAM_MISSING",
      );
    }

    await input.database.mediaAsset.update({
      where: { id: asset.id },
      data: {
        state: "ANALYZED",
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        metadata: technicalMetadata(asset.metadata, probe),
      },
    });

    await input.database.mediaAnalysis.update({
      where: { id: analysis.id },
      data: {
        state: "SUCCEEDED",
        quality: {
          technicalProbePassed: true,
          hasVideo: probe.hasVideo,
          hasAudio: probe.hasAudio,
        },
        visual: probe.hasVideo
          ? {
              width: probe.width,
              height: probe.height,
              frameRate: probe.frameRate,
            }
          : Prisma.JsonNull,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });

    return {
      mediaAssetId: asset.id,
      analysisId: analysis.id,
      durationMs: probe.durationMs,
      width: probe.width,
      height: probe.height,
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
    };
  } catch (error) {
    const code =
      error instanceof MediaToolError ? error.code : "MEDIA_PREPROCESS_FAILED";
    const message =
      error instanceof Error
        ? error.message
        : "Unknown media preprocessing error";

    await Promise.allSettled([
      input.database.mediaAsset.update({
        where: { id: asset.id },
        data: { state: "INVALID" },
      }),
      input.database.mediaAnalysis.update({
        where: { id: analysis.id },
        data: {
          state: "FAILED",
          errorCode: code,
          errorMessage: message.slice(0, 4000),
          completedAt: new Date(),
        },
      }),
    ]);

    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export interface PreparedFrame {
  index: number;
  timestampMs: number;
  path: string;
}

export interface PreparedMediaWorkspace {
  mediaAssetId: string;
  sourcePath: string;
  probe: MediaProbeResult;
  frames: PreparedFrame[];
  audioPath: string | null;
}

export interface PrepareMediaOptions {
  frameCount?: number;
  maxFrameWidth?: number;
  audioSampleRate?: number;
  timeoutMs?: number;
}

export function representativeFrameTimestamps(
  durationMs: number,
  requestedCount = 4,
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [0];
  const count = Math.max(1, Math.min(8, Math.trunc(requestedCount)));
  if (durationMs < 1_000 || count === 1)
    return [Math.max(0, Math.round(durationMs / 2))];

  const fractions =
    count === 4
      ? [0.1, 0.35, 0.6, 0.85]
      : Array.from({ length: count }, (_, index) => (index + 1) / (count + 1));
  const maximum = Math.max(0, durationMs - 100);
  return [
    ...new Set(
      fractions.map((fraction) =>
        Math.min(maximum, Math.max(0, Math.round(durationMs * fraction))),
      ),
    ),
  ];
}

export async function extractRepresentativeFrames(input: {
  sourcePath: string;
  destinationDir: string;
  durationMs: number;
  toolchain: MediaToolchain;
  frameCount?: number;
  maxWidth?: number;
  timeoutMs?: number;
}): Promise<PreparedFrame[]> {
  const timestamps = representativeFrameTimestamps(
    input.durationMs,
    input.frameCount ?? 4,
  );
  const maxWidth = Math.max(
    320,
    Math.min(1920, Math.trunc(input.maxWidth ?? 1280)),
  );
  const frames: PreparedFrame[] = [];

  for (const [index, timestampMs] of timestamps.entries()) {
    const outputPath = join(
      input.destinationDir,
      `frame-${String(index + 1).padStart(2, "0")}.jpg`,
    );
    await runCaptured(
      input.toolchain.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-ss",
        (timestampMs / 1000).toFixed(3),
        "-i",
        input.sourcePath,
        "-frames:v",
        "1",
        "-vf",
        `scale='min(${maxWidth},iw)':-2`,
        "-q:v",
        "3",
        "-y",
        outputPath,
      ],
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || outputStat.size <= 0) {
      throw new MediaToolError(
        `FFmpeg did not produce representative frame ${index + 1}`,
        "FRAME_EXTRACTION_EMPTY",
      );
    }
    frames.push({ index, timestampMs, path: outputPath });
  }

  return frames;
}

export async function extractNormalizedAudio(input: {
  sourcePath: string;
  destinationPath: string;
  toolchain: MediaToolchain;
  sampleRate?: number;
  timeoutMs?: number;
}): Promise<string> {
  const sampleRate = Math.max(
    8_000,
    Math.min(48_000, Math.trunc(input.sampleRate ?? 16_000)),
  );
  await runCaptured(
    input.toolchain.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      input.sourcePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-c:a",
      "pcm_s16le",
      "-y",
      input.destinationPath,
    ],
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const outputStat = await stat(input.destinationPath);
  if (!outputStat.isFile() || outputStat.size <= 44) {
    throw new MediaToolError(
      "FFmpeg did not produce normalized audio",
      "AUDIO_EXTRACTION_EMPTY",
    );
  }
  return input.destinationPath;
}

export async function withPreparedMediaAsset<T>(input: {
  mediaAssetId: string;
  storage: MediaStorage;
  database: Pick<MediaIntelligenceDatabase, "mediaAsset">;
  toolchain: MediaToolchain;
  options?: PrepareMediaOptions;
  consume: (workspace: PreparedMediaWorkspace) => Promise<T>;
}): Promise<T> {
  const asset = await input.database.mediaAsset.findUnique({
    where: { id: input.mediaAssetId },
    select: {
      id: true,
      driveFileId: true,
      name: true,
      mimeType: true,
      kind: true,
    },
  });

  if (!asset) {
    throw new Error(`MediaAsset not found: ${input.mediaAssetId}`);
  }

  if (!["RAW_VIDEO", "AUDIO"].includes(asset.kind)) {
    throw new Error(
      `MediaAsset ${asset.id} kind ${asset.kind} cannot be prepared`,
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "brandspace-prepared-"));

  const sourcePath = join(
    workDir,
    `source${extensionFor(asset.name, asset.mimeType)}`,
  );

  try {
    await input.storage.downloadToFile(asset.driveFileId, sourcePath);

    const sourceStat = await stat(sourcePath);

    if (!sourceStat.isFile() || sourceStat.size <= 0) {
      throw new MediaToolError(
        "Downloaded media is empty or not a regular file",
        "MEDIA_DOWNLOAD_INVALID",
      );
    }

    const probe = await probeMedia(sourcePath, input.toolchain);

    if (asset.kind === "RAW_VIDEO" && !probe.hasVideo) {
      throw new MediaToolError(
        "Expected a video stream but ffprobe found none",
        "VIDEO_STREAM_MISSING",
      );
    }

    if (asset.kind === "AUDIO" && !probe.hasAudio) {
      throw new MediaToolError(
        "Expected an audio stream but ffprobe found none",
        "AUDIO_STREAM_MISSING",
      );
    }

    const frames =
      probe.hasVideo && probe.durationMs !== null
        ? await extractRepresentativeFrames({
            sourcePath,
            destinationDir: workDir,
            durationMs: probe.durationMs,
            toolchain: input.toolchain,

            ...(input.options?.frameCount !== undefined
              ? { frameCount: input.options.frameCount }
              : {}),

            ...(input.options?.maxFrameWidth !== undefined
              ? { maxWidth: input.options.maxFrameWidth }
              : {}),

            ...(input.options?.timeoutMs !== undefined
              ? { timeoutMs: input.options.timeoutMs }
              : {}),
          })
        : [];

    const audioPath = probe.hasAudio
      ? join(workDir, "audio-16khz-mono.wav")
      : null;

    if (audioPath) {
      await extractNormalizedAudio({
        sourcePath,
        destinationPath: audioPath,
        toolchain: input.toolchain,

        ...(input.options?.audioSampleRate !== undefined
          ? { sampleRate: input.options.audioSampleRate }
          : {}),

        ...(input.options?.timeoutMs !== undefined
          ? { timeoutMs: input.options.timeoutMs }
          : {}),
      });
    }

    return await input.consume({
      mediaAssetId: asset.id,
      sourcePath,
      probe,
      frames,
      audioPath,
    });
  } finally {
    await rm(workDir, {
      recursive: true,
      force: true,
    });
  }
}
