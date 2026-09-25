import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { Prisma, type PrismaClient } from "@forge/database";
import type { MediaStorage } from "@forge/storage";
import {
  MediaToolError,
  type MediaToolchain,
  type PreparedFrame,
  withPreparedMediaAsset,
} from "./index";

export interface SemanticSceneInput {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  confidence: number | null;
}

export interface SemanticSegment {
  sceneIndex: number;
  startMs: number;
  endMs: number;
  description: string;
  spokenContext: string | null;
  relevanceScore: number;
}

export interface SemanticUnderstanding {
  summary: string;
  tags: string[];
  subjects: string[];
  visual: {
    setting: string;
    peopleCount: number | null;
    shotType: string;
    lighting: string;
    dominantColors: string[];
    onScreenText: string[];
    objects: string[];
    actions: string[];
  };
  content: {
    topic: string;
    hook: string | null;
    cta: string | null;
    contentType: string;
    mood: string;
  };
  quality: {
    clarity: number;
    framing: number;
    lighting: number;
    audio: number;
    overall: number;
    issues: string[];
  };
  semanticSegments: SemanticSegment[];
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface SemanticAnalysisProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: {
    frames: PreparedFrame[];
    transcript: string | null;
    language: string | null;
    scenes: SemanticSceneInput[];
  }): Promise<SemanticUnderstanding>;
}

export interface SemanticAnalysisDatabase {
  mediaAsset: Pick<PrismaClient["mediaAsset"], "findUnique" | "update">;
  mediaAnalysis: Pick<
    PrismaClient["mediaAnalysis"],
    "create" | "findFirst" | "update"
  >;
  aiProvenance: Pick<PrismaClient["aiProvenance"], "create">;
  usageLedger: Pick<PrismaClient["usageLedger"], "create">;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const strings = (value: unknown, limit = 20): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const nullableText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const score = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
};

const nullableInteger = (value: unknown): number | null => {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
};

const semanticSchema = {
  name: "media_semantic_understanding",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      subjects: { type: "array", items: { type: "string" } },
      visual: {
        type: "object",
        additionalProperties: false,
        properties: {
          setting: { type: "string" },
          peopleCount: { type: ["integer", "null"] },
          shotType: { type: "string" },
          lighting: { type: "string" },
          dominantColors: { type: "array", items: { type: "string" } },
          onScreenText: { type: "array", items: { type: "string" } },
          objects: { type: "array", items: { type: "string" } },
          actions: { type: "array", items: { type: "string" } },
        },
        required: [
          "setting",
          "peopleCount",
          "shotType",
          "lighting",
          "dominantColors",
          "onScreenText",
          "objects",
          "actions",
        ],
      },
      content: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          hook: { type: ["string", "null"] },
          cta: { type: ["string", "null"] },
          contentType: { type: "string" },
          mood: { type: "string" },
        },
        required: ["topic", "hook", "cta", "contentType", "mood"],
      },
      quality: {
        type: "object",
        additionalProperties: false,
        properties: {
          clarity: { type: "number" },
          framing: { type: "number" },
          lighting: { type: "number" },
          audio: { type: "number" },
          overall: { type: "number" },
          issues: { type: "array", items: { type: "string" } },
        },
        required: [
          "clarity",
          "framing",
          "lighting",
          "audio",
          "overall",
          "issues",
        ],
      },
      semanticSegments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sceneIndex: { type: "integer" },
            startMs: { type: "integer" },
            endMs: { type: "integer" },
            description: { type: "string" },
            spokenContext: { type: ["string", "null"] },
            relevanceScore: { type: "number" },
          },
          required: [
            "sceneIndex",
            "startMs",
            "endMs",
            "description",
            "spokenContext",
            "relevanceScore",
          ],
        },
      },
    },
    required: [
      "summary",
      "tags",
      "subjects",
      "visual",
      "content",
      "quality",
      "semanticSegments",
    ],
  },
} as const;

const normalizeUnderstanding = (
  raw: unknown,
  provider: string,
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): SemanticUnderstanding => {
  if (!isRecord(raw)) {
    throw new MediaToolError(
      "Semantic provider returned a non-object response",
      "SEMANTIC_OUTPUT_INVALID",
    );
  }

  const visual = isRecord(raw.visual) ? raw.visual : {};
  const content = isRecord(raw.content) ? raw.content : {};
  const quality = isRecord(raw.quality) ? raw.quality : {};
  const segments = Array.isArray(raw.semanticSegments)
    ? raw.semanticSegments
    : [];
  const summary = text(raw.summary);
  if (!summary) {
    throw new MediaToolError(
      "Semantic provider returned an empty summary",
      "SEMANTIC_OUTPUT_INVALID",
    );
  }

  return {
    summary,
    tags: strings(raw.tags),
    subjects: strings(raw.subjects),
    visual: {
      setting: text(visual.setting, "unknown"),
      peopleCount: nullableInteger(visual.peopleCount),
      shotType: text(visual.shotType, "unknown"),
      lighting: text(visual.lighting, "unknown"),
      dominantColors: strings(visual.dominantColors, 10),
      onScreenText: strings(visual.onScreenText, 20),
      objects: strings(visual.objects, 20),
      actions: strings(visual.actions, 20),
    },
    content: {
      topic: text(content.topic, "unknown"),
      hook: nullableText(content.hook),
      cta: nullableText(content.cta),
      contentType: text(content.contentType, "unknown"),
      mood: text(content.mood, "unknown"),
    },
    quality: {
      clarity: score(quality.clarity),
      framing: score(quality.framing),
      lighting: score(quality.lighting),
      audio: score(quality.audio),
      overall: score(quality.overall),
      issues: strings(quality.issues, 20),
    },
    semanticSegments: segments
      .filter(isRecord)
      .map((segment) => ({
        sceneIndex: nullableInteger(segment.sceneIndex) ?? 0,
        startMs: nullableInteger(segment.startMs) ?? 0,
        endMs: nullableInteger(segment.endMs) ?? 0,
        description: text(segment.description, "unknown"),
        spokenContext: nullableText(segment.spokenContext),
        relevanceScore: score(segment.relevanceScore),
      }))
      .filter((segment) => segment.endMs > segment.startMs),
    provider,
    model,
    inputTokens,
    outputTokens,
  };
};

export class OpenAISemanticAnalysisProvider implements SemanticAnalysisProvider {
  readonly name = "groq";

  constructor(
    private readonly client: OpenAI,
    readonly model = "qwen/qwen3.8-27b",
  ) {}

  async analyze(input: {
    frames: PreparedFrame[];
    transcript: string | null;
    language: string | null;
    scenes: SemanticSceneInput[];
  }): Promise<SemanticUnderstanding> {
    if (input.frames.length === 0) {
      throw new MediaToolError(
        "Semantic analysis requires at least one representative frame",
        "SEMANTIC_FRAMES_MISSING",
      );
    }

    const frameParts = await Promise.all(
      input.frames.slice(0, 3).map(async (frame) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:image/jpeg;base64,${(await readFile(frame.path)).toString("base64")}`,
          detail: "auto" as const,
        },
      })),
    );

    const context = JSON.stringify({
      transcript: input.transcript,
      language: input.language,
      scenes: input.scenes,
      frameTimestampsMs: input.frames
        .slice(0, 3)
        .map((frame) => frame.timestampMs),
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "Analyze short-form social media source footage. Ground every claim in the supplied frames, transcript, and deterministic scene boundaries. Do not invent brands, people, objects, spoken claims, or on-screen text. Quality scores must be numbers from 0 to 1. Semantic segments must reference only supplied scene indexes and remain within their timestamps.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Return structured semantic understanding for this media. Context: ${context}`,
            },
            ...frameParts,
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: semanticSchema,
      },
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new MediaToolError(
        "Semantic provider returned empty content",
        "SEMANTIC_OUTPUT_EMPTY",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new MediaToolError(
        "Semantic provider returned invalid JSON",
        "SEMANTIC_OUTPUT_INVALID",
      );
    }

    return normalizeUnderstanding(
      parsed,
      this.name,
      this.model,
      response.usage?.prompt_tokens ?? null,
      response.usage?.completion_tokens ?? null,
    );
  }
}

const sceneInputs = (value: Prisma.JsonValue | null): SemanticSceneInput[] => {
  if (!Array.isArray(value)) return [];

  const scenes: SemanticSceneInput[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;

    const scene: SemanticSceneInput = {
      index: nullableInteger(candidate.index) ?? -1,
      startMs: nullableInteger(candidate.startMs) ?? 0,
      endMs: nullableInteger(candidate.endMs) ?? 0,
      durationMs: nullableInteger(candidate.durationMs) ?? 0,
      confidence:
        typeof candidate.confidence === "number" &&
        Number.isFinite(candidate.confidence)
          ? candidate.confidence
          : null,
    };

    if (
      scene.index >= 0 &&
      scene.endMs > scene.startMs &&
      scene.durationMs > 0
    ) {
      scenes.push(scene);
    }
  }

  return scenes;
};

const jsonSemanticSegments = (
  segments: SemanticSegment[],
): Prisma.InputJsonArray =>
  segments.map((segment) => ({
    sceneIndex: segment.sceneIndex,
    startMs: segment.startMs,
    endMs: segment.endMs,
    description: segment.description,
    spokenContext: segment.spokenContext,
    relevanceScore: segment.relevanceScore,
  }));

const jsonVisual = (
  visual: SemanticUnderstanding["visual"],
): Prisma.InputJsonObject => ({
  setting: visual.setting,
  peopleCount: visual.peopleCount,
  shotType: visual.shotType,
  lighting: visual.lighting,
  dominantColors: visual.dominantColors,
  onScreenText: visual.onScreenText,
  objects: visual.objects,
  actions: visual.actions,
});

const jsonContent = (
  content: SemanticUnderstanding["content"],
): Prisma.InputJsonObject => ({
  topic: content.topic,
  hook: content.hook,
  cta: content.cta,
  contentType: content.contentType,
  mood: content.mood,
});

const jsonQuality = (
  quality: SemanticUnderstanding["quality"],
): Prisma.InputJsonObject => ({
  clarity: quality.clarity,
  framing: quality.framing,
  lighting: quality.lighting,
  audio: quality.audio,
  overall: quality.overall,
  issues: quality.issues,
});

const mergeJsonObject = (
  existing: Prisma.JsonValue | null,
  additions: Prisma.InputJsonObject,
): Prisma.InputJsonValue => ({
  ...(existing && typeof existing === "object" && !Array.isArray(existing)
    ? (existing as Prisma.JsonObject)
    : {}),
  ...additions,
});

export async function understandMediaAsset(input: {
  mediaAssetId: string;
  storage: MediaStorage;
  database: SemanticAnalysisDatabase;
  toolchain: MediaToolchain;
  provider: SemanticAnalysisProvider;
  force?: boolean;
}): Promise<{
  mediaAssetId: string;
  analysisId: string;
  summary: string;
  tags: string[];
  subjects: string[];
  semanticSegmentCount: number;
  provider: string;
  model: string;
}> {
  const asset = await input.database.mediaAsset.findUnique({
    where: { id: input.mediaAssetId },
    select: { id: true, clientId: true, kind: true },
  });

  if (!asset) throw new Error(`MediaAsset not found: ${input.mediaAssetId}`);
  if (asset.kind !== "RAW_VIDEO") {
    throw new MediaToolError(
      `MediaAsset ${asset.id} is not a video`,
      "SEMANTIC_VIDEO_REQUIRED",
    );
  }

  const existingAnalysis = await input.database.mediaAnalysis.findFirst({
    where: { mediaAssetId: asset.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      summary: true,
      tags: true,
      subjects: true,
      transcript: true,
      language: true,
      scenes: true,
      visual: true,
      quality: true,
    },
  });

  if (!existingAnalysis) {
    throw new MediaToolError(
      "Run transcription and scene detection before semantic analysis",
      "SEMANTIC_PREREQUISITES_MISSING",
    );
  }

  const scenes = sceneInputs(existingAnalysis.scenes);
  if (scenes.length === 0) {
    throw new MediaToolError(
      "Run scene detection before semantic analysis",
      "SEMANTIC_SCENES_MISSING",
    );
  }

  const semanticNode =
    existingAnalysis.visual &&
    typeof existingAnalysis.visual === "object" &&
    !Array.isArray(existingAnalysis.visual) &&
    isRecord((existingAnalysis.visual as Prisma.JsonObject).semantic)
      ? ((existingAnalysis.visual as Prisma.JsonObject).semantic as JsonRecord)
      : null;

  if (
    !input.force &&
    existingAnalysis.summary?.trim() &&
    semanticNode?.provider === input.provider.name &&
    semanticNode.model === input.provider.model
  ) {
    return {
      mediaAssetId: asset.id,
      analysisId: existingAnalysis.id,
      summary: existingAnalysis.summary,
      tags: existingAnalysis.tags,
      subjects: existingAnalysis.subjects,
      semanticSegmentCount: Array.isArray(semanticNode.semanticSegments)
        ? semanticNode.semanticSegments.length
        : 0,
      provider: input.provider.name,
      model: input.provider.model,
    };
  }

  const analysis = await input.database.mediaAnalysis.update({
    where: { id: existingAnalysis.id },
    data: {
      state: "RUNNING",
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(),
      completedAt: null,
    },
    select: { id: true },
  });

  const invocationStartedAt = Date.now();

  try {
    const result = await withPreparedMediaAsset<SemanticUnderstanding>({
      mediaAssetId: asset.id,
      storage: input.storage,
      database: input.database,
      toolchain: input.toolchain,
      options: {
        frameCount: 3,
        maxFrameWidth: 768,
        extractAudio: false,
      },
      consume: async (workspace) =>
        await input.provider.analyze({
          frames: workspace.frames,
          transcript: existingAnalysis.transcript,
          language: existingAnalysis.language,
          scenes,
        }),
    });

    const latencyMs = Date.now() - invocationStartedAt;
    const semanticVisual: Prisma.InputJsonObject = {
      semantic: {
        provider: result.provider,
        model: result.model,
        setting: result.visual.setting,
        peopleCount: result.visual.peopleCount,
        shotType: result.visual.shotType,
        lighting: result.visual.lighting,
        dominantColors: result.visual.dominantColors,
        onScreenText: result.visual.onScreenText,
        objects: result.visual.objects,
        actions: result.visual.actions,
        content: jsonContent(result.content),
        semanticSegments: jsonSemanticSegments(result.semanticSegments),
        completedAt: new Date().toISOString(),
      },
    };
    const semanticQuality: Prisma.InputJsonObject = {
      semantic: {
        clarity: result.quality.clarity,
        framing: result.quality.framing,
        lighting: result.quality.lighting,
        audio: result.quality.audio,
        overall: result.quality.overall,
        issues: result.quality.issues,
      },
    };

    await input.database.mediaAnalysis.update({
      where: { id: analysis.id },
      data: {
        state: "SUCCEEDED",
        summary: result.summary,
        tags: result.tags,
        subjects: result.subjects,
        visual: mergeJsonObject(existingAnalysis.visual, semanticVisual),
        quality: mergeJsonObject(existingAnalysis.quality, semanticQuality),
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });

    await Promise.all([
      input.database.aiProvenance.create({
        data: {
          clientId: asset.clientId,
          operation: "media.semantic_analyze",
          provider: result.provider,
          model: result.model,
          promptVersion: "media-semantic-v1",
          inputReference: {
            mediaAssetId: asset.id,
            analysisId: analysis.id,
            transcriptPresent: Boolean(existingAnalysis.transcript),
            sceneCount: scenes.length,
            frameCount: 3,
          },
          structuredOutput: {
            summary: result.summary,
            tags: result.tags,
            subjects: result.subjects,
            visual: jsonVisual(result.visual),
            content: jsonContent(result.content),
            quality: jsonQuality(result.quality),
            semanticSegments: jsonSemanticSegments(result.semanticSegments),
          },
          confidence: new Prisma.Decimal(result.quality.overall),
          latencyMs,
        },
      }),
      input.database.usageLedger.create({
        data: {
          clientId: asset.clientId,
          kind: "AI",
          provider: result.provider,
          operation: "media.semantic_analyze",
          model: result.model,
          inputUnits: result.inputTokens,
          outputUnits: result.outputTokens,
          metadata: {
            mediaAssetId: asset.id,
            analysisId: analysis.id,
            sceneCount: scenes.length,
            semanticSegmentCount: result.semanticSegments.length,
            latencyMs,
          },
        },
      }),
    ]);

    return {
      mediaAssetId: asset.id,
      analysisId: analysis.id,
      summary: result.summary,
      tags: result.tags,
      subjects: result.subjects,
      semanticSegmentCount: result.semanticSegments.length,
      provider: result.provider,
      model: result.model,
    };
  } catch (error) {
    const code =
      error instanceof MediaToolError ? error.code : "SEMANTIC_PROVIDER_FAILED";
    const message =
      error instanceof Error
        ? error.message
        : "Unknown semantic analysis error";

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
          kind: "AI",
          provider: input.provider.name,
          operation: "media.semantic_analyze.failed",
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
