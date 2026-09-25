import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { Prisma, type PrismaClient } from "@forge/database";
import type { MediaStorage } from "@forge/storage";
import {
  MediaToolError,
  type MediaToolchain,
  withPreparedMediaAsset,
} from "./index";

export interface TranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  durationMs: number | null;
  segments: TranscriptionSegment[];
  provider: string;
  model: string;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string;
  transcribe(input: {
    audioPath: string;
    language?: string;
  }): Promise<TranscriptionResult>;
}

export interface TranscriptionDatabase {
  mediaAsset: Pick<PrismaClient["mediaAsset"], "findUnique" | "update">;
  mediaAnalysis: Pick<
    PrismaClient["mediaAnalysis"],
    "create" | "findFirst" | "update"
  >;
  usageLedger: Pick<PrismaClient["usageLedger"], "create">;
}

type OpenAIVerboseTranscription = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
};

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly name = "groq";

  constructor(
    private readonly client: OpenAI,
    readonly model = "whisper-large-v3-turbo",
  ) {}

  async transcribe(input: {
    audioPath: string;
    language?: string;
  }): Promise<TranscriptionResult> {
    const response = (await this.client.audio.transcriptions.create({
      file: createReadStream(input.audioPath),
      model: this.model,
      response_format: "verbose_json",
      ...(input.language ? { language: input.language } : {}),
    })) as OpenAIVerboseTranscription;

    const text = response.text?.trim() ?? "";
    if (!text) {
      throw new MediaToolError(
        "Transcription provider returned empty text",
        "TRANSCRIPTION_EMPTY",
      );
    }

    return {
      text,
      language: response.language?.trim() || input.language || null,
      durationMs:
        typeof response.duration === "number" &&
        Number.isFinite(response.duration)
          ? Math.round(response.duration * 1000)
          : null,
      segments: (response.segments ?? [])
        .filter(
          (segment) =>
            typeof segment.start === "number" &&
            typeof segment.end === "number" &&
            typeof segment.text === "string",
        )
        .map((segment) => ({
          startMs: Math.max(0, Math.round((segment.start ?? 0) * 1000)),
          endMs: Math.max(0, Math.round((segment.end ?? 0) * 1000)),
          text: segment.text?.trim() ?? "",
        }))
        .filter((segment) => segment.text.length > 0),
      provider: this.name,
      model: this.model,
    };
  }
}

const transcriptQuality = (
  existing: Prisma.JsonValue | null,
  result: TranscriptionResult,
): Prisma.InputJsonValue => {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Prisma.JsonObject)
      : {};

  return {
    ...base,
    transcription: {
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs,
      segmentCount: result.segments.length,
      segments: result.segments.map((segment) => ({
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      })),
      completedAt: new Date().toISOString(),
    },
  };
};

const cachedTranscription = (
  transcript: string | null,
  language: string | null,
  quality: Prisma.JsonValue | null,
  provider: TranscriptionProvider,
) => {
  if (
    !transcript?.trim() ||
    !quality ||
    typeof quality !== "object" ||
    Array.isArray(quality)
  ) {
    return null;
  }

  const node = (quality as Prisma.JsonObject).transcription;
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;

  const record = node as Prisma.JsonObject;
  if (record.provider !== provider.name || record.model !== provider.model) {
    return null;
  }

  return {
    transcript,
    language,
    segmentCount:
      typeof record.segmentCount === "number" &&
      Number.isFinite(record.segmentCount)
        ? Math.max(0, Math.trunc(record.segmentCount))
        : 0,
    provider: provider.name,
    model: provider.model,
  };
};

export async function transcribeMediaAsset(input: {
  mediaAssetId: string;
  storage: MediaStorage;
  database: TranscriptionDatabase;
  toolchain: MediaToolchain;
  provider: TranscriptionProvider;
  language?: string;
  force?: boolean;
}): Promise<{
  mediaAssetId: string;
  analysisId: string;
  transcript: string;
  language: string | null;
  segmentCount: number;
  provider: string;
  model: string;
}> {
  const asset = await input.database.mediaAsset.findUnique({
    where: { id: input.mediaAssetId },
    select: {
      id: true,
      clientId: true,
    },
  });

  if (!asset) throw new Error(`MediaAsset not found: ${input.mediaAssetId}`);

  const existingAnalysis = await input.database.mediaAnalysis.findFirst({
    where: { mediaAssetId: asset.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      transcript: true,
      language: true,
      quality: true,
    },
  });

  const cached = existingAnalysis
    ? cachedTranscription(
        existingAnalysis.transcript,
        existingAnalysis.language,
        existingAnalysis.quality,
        input.provider,
      )
    : null;

  if (cached && !input.force) {
    return {
      mediaAssetId: asset.id,
      analysisId: existingAnalysis!.id,
      ...cached,
    };
  }

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

  const invocationStartedAt = Date.now();

  try {
    const result = await withPreparedMediaAsset<TranscriptionResult>({
      mediaAssetId: asset.id,
      storage: input.storage,
      database: input.database,
      toolchain: input.toolchain,
      options: { extractFrames: false },
      consume: async (workspace) => {
        if (!workspace.audioPath) {
          throw new MediaToolError(
            "Media has no audio stream to transcribe",
            "TRANSCRIPTION_AUDIO_MISSING",
          );
        }

        return await input.provider.transcribe({
          audioPath: workspace.audioPath,
          ...(input.language ? { language: input.language } : {}),
        });
      },
    });

    await input.database.mediaAnalysis.update({
      where: { id: analysis.id },
      data: {
        state: "SUCCEEDED",
        transcript: result.text,
        language: result.language,
        quality: transcriptQuality(existingAnalysis?.quality ?? null, result),
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });

    await input.database.usageLedger.create({
      data: {
        clientId: asset.clientId,
        kind: "TRANSCRIPTION",
        provider: result.provider,
        operation: "media.transcribe",
        model: result.model,
        ...(result.durationMs !== null
          ? {
              quantity: new Prisma.Decimal(result.durationMs / 60_000),
            }
          : {}),
        unit: result.durationMs === null ? null : "minute",
        metadata: {
          mediaAssetId: asset.id,
          analysisId: analysis.id,
          durationMs: result.durationMs,
          segmentCount: result.segments.length,
          latencyMs: Date.now() - invocationStartedAt,
        },
      },
    });

    return {
      mediaAssetId: asset.id,
      analysisId: analysis.id,
      transcript: result.text,
      language: result.language,
      segmentCount: result.segments.length,
      provider: result.provider,
      model: result.model,
    };
  } catch (error) {
    const code =
      error instanceof MediaToolError
        ? error.code
        : "TRANSCRIPTION_PROVIDER_FAILED";
    const message =
      error instanceof Error ? error.message : "Unknown transcription error";

    await Promise.allSettled([
      input.database.mediaAnalysis.update({
        where: { id: analysis.id },
        data: {
          state: "FAILED",
          errorCode: code,
          errorMessage: message.slice(0, 4000),
          completedAt: new Date(),
        },
      }),
      input.database.usageLedger.create({
        data: {
          clientId: asset.clientId,
          kind: "TRANSCRIPTION",
          provider: input.provider.name,
          operation: "media.transcribe.failed",
          model: input.provider.model,
          metadata: {
            mediaAssetId: asset.id,
            analysisId: analysis.id,
            latencyMs: Date.now() - invocationStartedAt,
            errorCode: code,
          },
        },
      }),
    ]);

    throw error;
  }
}
