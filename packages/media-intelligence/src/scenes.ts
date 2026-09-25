import { Prisma, type PrismaClient } from "@forge/database";
import type { MediaStorage } from "@forge/storage";
import {
  MediaToolError,
  type MediaToolchain,
  withPreparedMediaAsset,
} from "./index";

export interface SceneBoundary {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  confidence: number | null;
}

export interface UsableSegment {
  sceneIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  score: number;
  reasons: string[];
}

export interface SceneDetectionOptions {
  threshold?: number;
  minSceneMs?: number;
  maxSceneMs?: number;
  timeoutMs?: number;
}

export interface SceneDetectionDatabase {
  mediaAsset: Pick<PrismaClient["mediaAsset"], "findUnique" | "update">;
  mediaAnalysis: Pick<
    PrismaClient["mediaAnalysis"],
    "create" | "findFirst" | "update"
  >;
}

const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_MIN_SCENE_MS = 700;
const DEFAULT_MAX_SCENE_MS = 12_000;

const clampThreshold = (value: number | undefined) =>
  Math.max(0.05, Math.min(0.95, value ?? DEFAULT_THRESHOLD));

const positiveMs = (value: number | undefined, fallback: number) =>
  Math.max(100, Math.trunc(value ?? fallback));

export function parseSceneChangeOutput(stderr: string): Array<{
  timestampMs: number;
  score: number | null;
}> {
  const detections: Array<{ timestampMs: number; score: number | null }> = [];
  const lines = stderr.split(/\r?\n/);
  let pendingIndex: number | null = null;

  for (const line of lines) {
    const ptsMatch = line.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/);
    if (ptsMatch?.[1]) {
      const seconds = Number(ptsMatch[1]);
      if (Number.isFinite(seconds) && seconds >= 0) {
        detections.push({
          timestampMs: Math.round(seconds * 1000),
          score: null,
        });
        pendingIndex = detections.length - 1;
      }
    }

    const scoreMatch = line.match(/lavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)/);
    if (scoreMatch?.[1] && pendingIndex !== null) {
      const score = Number(scoreMatch[1]);
      if (Number.isFinite(score)) {
        const pending = detections[pendingIndex];
        if (pending) pending.score = score;
      }
      pendingIndex = null;
    }
  }

  return detections;
}

export function buildScenes(
  durationMs: number,
  detections: Array<{ timestampMs: number; score: number | null }>,
): SceneBoundary[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  const byTimestamp = new Map<number, number | null>();
  for (const detection of detections) {
    if (detection.timestampMs <= 0 || detection.timestampMs >= durationMs)
      continue;
    const existing = byTimestamp.get(detection.timestampMs);
    if (
      existing === undefined ||
      (detection.score !== null &&
        (existing === null || detection.score > existing))
    ) {
      byTimestamp.set(detection.timestampMs, detection.score);
    }
  }

  const cuts = [...byTimestamp.entries()]
    .map(([timestampMs, score]) => ({ timestampMs, score }))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const scenes: SceneBoundary[] = [];
  let startMs = 0;

  for (const cut of cuts) {
    scenes.push({
      index: scenes.length,
      startMs,
      endMs: cut.timestampMs,
      durationMs: cut.timestampMs - startMs,
      confidence: cut.score,
    });
    startMs = cut.timestampMs;
  }

  scenes.push({
    index: scenes.length,
    startMs,
    endMs: durationMs,
    durationMs: durationMs - startMs,
    confidence: null,
  });

  return scenes;
}

export function rankUsableSegments(
  scenes: SceneBoundary[],
  options: Pick<SceneDetectionOptions, "minSceneMs" | "maxSceneMs"> = {},
): UsableSegment[] {
  const minSceneMs = positiveMs(options.minSceneMs, DEFAULT_MIN_SCENE_MS);
  const maxSceneMs = Math.max(
    minSceneMs,
    positiveMs(options.maxSceneMs, DEFAULT_MAX_SCENE_MS),
  );

  return scenes
    .filter(
      (scene) =>
        scene.durationMs >= minSceneMs && scene.durationMs <= maxSceneMs,
    )
    .map((scene) => {
      const targetMs = Math.min(5_000, maxSceneMs);
      const durationFit = Math.max(
        0,
        1 - Math.abs(scene.durationMs - targetMs) / Math.max(targetMs, 1),
      );
      const cutConfidence = scene.confidence ?? 0.5;
      const score = Number(
        (durationFit * 0.65 + cutConfidence * 0.35).toFixed(4),
      );

      return {
        sceneIndex: scene.index,
        startMs: scene.startMs,
        endMs: scene.endMs,
        durationMs: scene.durationMs,
        score,
        reasons: [
          "duration_within_bounds",
          scene.confidence === null ? "terminal_scene" : "visual_cut_detected",
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.startMs - b.startMs);
}

async function detectSceneChanges(input: {
  sourcePath: string;
  toolchain: MediaToolchain;
  threshold: number;
  timeoutMs?: number;
}) {
  const { spawn } = await import("node:child_process");

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      input.toolchain.ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        input.sourcePath,
        "-an",
        "-vf",
        `select=gt(scene\\,${input.threshold}),metadata=print`,
        "-f",
        "null",
        "-",
      ],
      { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(stderr);
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr, "utf8") > 8 * 1024 * 1024) {
        child.kill();
        finish(
          new MediaToolError(
            "FFmpeg scene output exceeded capture limit",
            "SCENE_OUTPUT_LIMIT",
          ),
        );
      }
    });
    child.once("error", (error) =>
      finish(
        new MediaToolError(
          `Unable to start FFmpeg scene detection: ${error.message}`,
          "MEDIA_TOOL_NOT_FOUND",
        ),
      ),
    );
    child.once("close", (code) => {
      if (settled) return;
      code === 0
        ? finish()
        : finish(
            new MediaToolError(
              `FFmpeg scene detection failed with exit code ${code ?? "unknown"}`,
              "SCENE_DETECTION_FAILED",
              stderr.slice(-4000),
            ),
          );
    });

    const timer = setTimeout(() => {
      child.kill();
      finish(
        new MediaToolError(
          "FFmpeg scene detection timed out",
          "MEDIA_TOOL_TIMEOUT",
          stderr.slice(-4000),
        ),
      );
    }, input.timeoutMs ?? 120_000);
  });
}

const jsonScenes = (scenes: SceneBoundary[]): Prisma.InputJsonArray =>
  scenes.map((scene) => ({
    index: scene.index,
    startMs: scene.startMs,
    endMs: scene.endMs,
    durationMs: scene.durationMs,
    confidence: scene.confidence,
  }));

const jsonUsableSegments = (segments: UsableSegment[]): Prisma.InputJsonArray =>
  segments.map((segment) => ({
    sceneIndex: segment.sceneIndex,
    startMs: segment.startMs,
    endMs: segment.endMs,
    durationMs: segment.durationMs,
    score: segment.score,
    reasons: segment.reasons,
  }));

export async function detectMediaScenes(input: {
  mediaAssetId: string;
  storage: MediaStorage;
  database: SceneDetectionDatabase;
  toolchain: MediaToolchain;
  options?: SceneDetectionOptions;
}): Promise<{
  mediaAssetId: string;
  analysisId: string;
  durationMs: number;
  sceneCount: number;
  usableSegmentCount: number;
  scenes: SceneBoundary[];
  usableSegments: UsableSegment[];
}> {
  const asset = await input.database.mediaAsset.findUnique({
    where: { id: input.mediaAssetId },
    select: { id: true, kind: true },
  });

  if (!asset) throw new Error(`MediaAsset not found: ${input.mediaAssetId}`);
  if (asset.kind !== "RAW_VIDEO") {
    throw new MediaToolError(
      `MediaAsset ${asset.id} is not a video`,
      "SCENE_VIDEO_REQUIRED",
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

  try {
    const result = await withPreparedMediaAsset<{
      durationMs: number;
      scenes: SceneBoundary[];
      usableSegments: UsableSegment[];
    }>({
      mediaAssetId: asset.id,
      storage: input.storage,
      database: input.database,
      toolchain: input.toolchain,
      options: { extractFrames: false, extractAudio: false },
      consume: async (workspace) => {
        if (workspace.probe.durationMs === null) {
          throw new MediaToolError(
            "Video duration is required for scene detection",
            "SCENE_DURATION_MISSING",
          );
        }

        const threshold = clampThreshold(input.options?.threshold);
        const stderr = await detectSceneChanges({
          sourcePath: workspace.sourcePath,
          toolchain: input.toolchain,
          threshold,
          ...(input.options?.timeoutMs !== undefined
            ? { timeoutMs: input.options.timeoutMs }
            : {}),
        });
        const scenes = buildScenes(
          workspace.probe.durationMs,
          parseSceneChangeOutput(stderr),
        );
        return {
          durationMs: workspace.probe.durationMs,
          scenes,
          usableSegments: rankUsableSegments(scenes, input.options),
        };
      },
    });

    await input.database.mediaAnalysis.update({
      where: { id: analysis.id },
      data: {
        state: "SUCCEEDED",
        scenes: jsonScenes(result.scenes),
        usableSegments: jsonUsableSegments(result.usableSegments),
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });

    return {
      mediaAssetId: asset.id,
      analysisId: analysis.id,
      durationMs: result.durationMs,
      sceneCount: result.scenes.length,
      usableSegmentCount: result.usableSegments.length,
      scenes: result.scenes,
      usableSegments: result.usableSegments,
    };
  } catch (error) {
    const code =
      error instanceof MediaToolError ? error.code : "SCENE_DETECTION_FAILED";
    const message =
      error instanceof Error ? error.message : "Unknown scene detection error";

    await input.database.mediaAnalysis
      .update({
        where: { id: analysis.id },
        data: {
          state: "FAILED",
          errorCode: code,
          errorMessage: message.slice(0, 4000),
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);

    throw error;
  }
}
