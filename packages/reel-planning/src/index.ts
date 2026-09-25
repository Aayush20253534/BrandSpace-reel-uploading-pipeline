import { Prisma, type PrismaClient } from "@forge/database";

export const REEL_BLUEPRINT_VERSION = "reel-blueprint-v1" as const;
export const REEL_PLANNING_PROMPT_VERSION = "reel-planning-prompt-v2" as const;

export type ReelSectionRole =
  "HOOK" | "BODY" | "PROOF" | "CTA" | "BROLL" | "OTHER";

export interface ReelSourceCandidate {
  mediaAssetId: string;
  sceneIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  score: number;
  summary: string | null;
  transcript: string | null;
  tags: string[];
  subjects: string[];
}

export interface ReelPlanClip {
  mediaAssetId: string;
  sceneIndex: number;
  startMs: number;
  endMs: number;
  role: ReelSectionRole;
  purpose: string;
}

export interface ReelBlueprint {
  schemaVersion: typeof REEL_BLUEPRINT_VERSION;
  title: string;
  objective: string;
  targetDurationMs: number;
  hook: string;
  caption: string | null;
  cta: string | null;
  clips: ReelPlanClip[];
}

export interface ReelPlanningContext {
  reelProjectId: string;
  clientId: string;
  title: string;
  objective: string;
  brand: {
    positioning: string | null;
    targetAudience: string | null;
    audiencePainPoints: string[];
    contentPillars: string[];
    tone: string[];
    preferredHooks: string[];
    forbiddenTopics: string[];
    preferredWords: string[];
    bannedWords: string[];
    ctaRules: Prisma.JsonValue | null;
    reelStyle: Prisma.JsonValue | null;
    complianceRules: Prisma.JsonValue | null;
  } | null;
  candidates: ReelSourceCandidate[];
}

export interface ReelPlanningProviderResult {
  blueprint: ReelBlueprint;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  confidence: number | null;
  promptVersion?: string;
}

export interface ReelPlanningProvider {
  readonly name: string;
  readonly model: string;
  plan(input: ReelPlanningContext): Promise<ReelPlanningProviderResult>;
}

export class ReelPlanningError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ReelPlanningError";
  }
}

type PlanningDatabase = Pick<PrismaClient, "$transaction"> & {
  reelProject: Pick<PrismaClient["reelProject"], "findUnique" | "update">;
  reelVersion: Pick<PrismaClient["reelVersion"], "findFirst" | "create">;
  mediaAsset: Pick<PrismaClient["mediaAsset"], "findMany">;
  aiProvenance: Pick<PrismaClient["aiProvenance"], "create">;
  usageLedger: Pick<PrismaClient["usageLedger"], "create">;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finiteInteger = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const finiteNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const candidateKey = (
  mediaAssetId: string,
  sceneIndex: number,
  startMs: number,
  endMs: number,
) => `${mediaAssetId}:${sceneIndex}:${startMs}:${endMs}`;

const parseUsableSegments = (
  mediaAssetId: string,
  value: Prisma.JsonValue | null,
  analysis: {
    summary: string | null;
    transcript: string | null;
    tags: string[];
    subjects: string[];
  },
): ReelSourceCandidate[] => {
  if (!Array.isArray(value)) return [];

  const candidates: ReelSourceCandidate[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const sceneIndex = finiteInteger(item.sceneIndex);
    const startMs = finiteInteger(item.startMs);
    const endMs = finiteInteger(item.endMs);
    const score = finiteNumber(item.score);
    if (
      sceneIndex === null ||
      sceneIndex < 0 ||
      startMs === null ||
      startMs < 0 ||
      endMs === null ||
      endMs <= startMs
    ) {
      continue;
    }

    candidates.push({
      mediaAssetId,
      sceneIndex,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      score: score === null ? 0 : Math.max(0, Math.min(1, score)),
      summary: analysis.summary,
      transcript: analysis.transcript,
      tags: analysis.tags,
      subjects: analysis.subjects,
    });
  }

  return candidates;
};

export function validateReelBlueprint(
  blueprint: ReelBlueprint,
  candidates: ReelSourceCandidate[],
): ReelBlueprint {
  if (blueprint.schemaVersion !== REEL_BLUEPRINT_VERSION) {
    throw new ReelPlanningError(
      `Unsupported reel blueprint schema: ${blueprint.schemaVersion}`,
      "REEL_BLUEPRINT_SCHEMA_UNSUPPORTED",
    );
  }
  if (!blueprint.title.trim() || !blueprint.objective.trim()) {
    throw new ReelPlanningError(
      "Reel blueprint requires a title and objective",
      "REEL_BLUEPRINT_TEXT_REQUIRED",
    );
  }
  if (
    !Number.isInteger(blueprint.targetDurationMs) ||
    blueprint.targetDurationMs < 1_000 ||
    blueprint.targetDurationMs > 180_000
  ) {
    throw new ReelPlanningError(
      "Reel target duration must be between 1 and 180 seconds",
      "REEL_BLUEPRINT_DURATION_INVALID",
    );
  }
  if (blueprint.clips.length === 0) {
    throw new ReelPlanningError(
      "Reel blueprint requires at least one source clip",
      "REEL_BLUEPRINT_CLIPS_REQUIRED",
    );
  }

  const allowed = new Set(
    candidates.map((candidate) =>
      candidateKey(
        candidate.mediaAssetId,
        candidate.sceneIndex,
        candidate.startMs,
        candidate.endMs,
      ),
    ),
  );

  const seen = new Set<string>();
  for (const clip of blueprint.clips) {
    const key = candidateKey(
      clip.mediaAssetId,
      clip.sceneIndex,
      clip.startMs,
      clip.endMs,
    );
    if (!allowed.has(key)) {
      throw new ReelPlanningError(
        `Planner selected a source outside deterministic candidates: ${key}`,
        "REEL_BLUEPRINT_SOURCE_INVALID",
      );
    }
    if (seen.has(key)) {
      throw new ReelPlanningError(
        `Planner selected the same source twice: ${key}`,
        "REEL_BLUEPRINT_SOURCE_DUPLICATE",
      );
    }
    seen.add(key);
    if (!clip.purpose.trim()) {
      throw new ReelPlanningError(
        "Every reel clip requires a purpose",
        "REEL_BLUEPRINT_PURPOSE_REQUIRED",
      );
    }
  }

  return blueprint;
}

const normalizePolicyTerm = (value: string) => value.trim().toLocaleLowerCase();

export function validateBrandPolicy(
  blueprint: ReelBlueprint,
  context: ReelPlanningContext,
): ReelBlueprint {
  const bannedWords =
    context.brand?.bannedWords.map(normalizePolicyTerm).filter(Boolean) ?? [];
  if (bannedWords.length === 0) return blueprint;

  const generatedText = [
    blueprint.hook,
    blueprint.caption,
    blueprint.cta,
    ...blueprint.clips.map((clip) => clip.purpose),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLocaleLowerCase();

  const matched = bannedWords.find((term) => generatedText.includes(term));
  if (matched) {
    throw new ReelPlanningError(
      `Reel blueprint contains banned brand wording: ${matched}`,
      "REEL_BLUEPRINT_BRAND_POLICY_VIOLATION",
    );
  }

  return blueprint;
}

export function reelBlueprintJson(
  blueprint: ReelBlueprint,
): Prisma.InputJsonObject {
  return {
    schemaVersion: blueprint.schemaVersion,
    title: blueprint.title,
    objective: blueprint.objective,
    targetDurationMs: blueprint.targetDurationMs,
    hook: blueprint.hook,
    caption: blueprint.caption,
    cta: blueprint.cta,
    clips: blueprint.clips.map((clip) => ({
      mediaAssetId: clip.mediaAssetId,
      sceneIndex: clip.sceneIndex,
      startMs: clip.startMs,
      endMs: clip.endMs,
      role: clip.role,
      purpose: clip.purpose,
    })),
  };
}

export async function buildReelPlanningContext(input: {
  reelProjectId: string;
  database: PlanningDatabase;
}): Promise<ReelPlanningContext> {
  const project = await input.database.reelProject.findUnique({
    where: { id: input.reelProjectId },
    select: {
      id: true,
      clientId: true,
      title: true,
      objective: true,
      state: true,
      client: {
        select: {
          brandProfile: {
            select: {
              positioning: true,
              targetAudience: true,
              audiencePainPoints: true,
              contentPillars: true,
              tone: true,
              preferredHooks: true,
              forbiddenTopics: true,
              preferredWords: true,
              bannedWords: true,
              ctaRules: true,
              reelStyle: true,
              complianceRules: true,
            },
          },
        },
      },
    },
  });

  if (!project) {
    throw new ReelPlanningError(
      `ReelProject not found: ${input.reelProjectId}`,
      "REEL_PROJECT_NOT_FOUND",
    );
  }
  if (project.state !== "DRAFT" && project.state !== "REVISION_REQUESTED") {
    throw new ReelPlanningError(
      `ReelProject ${project.id} cannot be planned from ${project.state}`,
      "REEL_PROJECT_NOT_PLANNABLE",
    );
  }

  const assets = await input.database.mediaAsset.findMany({
    where: {
      clientId: project.clientId,
      kind: "RAW_VIDEO",
      state: "ANALYZED",
      analyses: { some: { state: "SUCCEEDED" } },
    },
    select: {
      id: true,
      analyses: {
        where: { state: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          summary: true,
          transcript: true,
          tags: true,
          subjects: true,
          usableSegments: true,
        },
      },
    },
  });

  const candidates = assets
    .flatMap((asset) => {
      const analysis = asset.analyses[0];
      return analysis
        ? parseUsableSegments(asset.id, analysis.usableSegments, analysis)
        : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.mediaAssetId.localeCompare(b.mediaAssetId) ||
        a.startMs - b.startMs,
    );

  if (candidates.length === 0) {
    throw new ReelPlanningError(
      "No analyzed source segments are available for reel planning",
      "REEL_SOURCE_CANDIDATES_EMPTY",
    );
  }

  return {
    reelProjectId: project.id,
    clientId: project.clientId,
    title: project.title,
    objective: project.objective?.trim() || project.title,
    brand: project.client.brandProfile,
    candidates,
  };
}

export async function planReelProject(input: {
  reelProjectId: string;
  database: PlanningDatabase;
  provider: ReelPlanningProvider;
}): Promise<{
  reelProjectId: string;
  reelVersionId: string;
  version: number;
  blueprint: ReelBlueprint;
  provider: string;
  model: string;
}> {
  const context = await buildReelPlanningContext(input);
  const startedAt = Date.now();
  const result = await input.provider.plan(context);
  const blueprint = validateBrandPolicy(
    validateReelBlueprint(result.blueprint, context.candidates),
    context,
  );
  const latencyMs = Date.now() - startedAt;
  const promptVersion =
    result.promptVersion?.trim() || REEL_PLANNING_PROMPT_VERSION;

  const persisted = await input.database.$transaction(
    async (tx) => {
      const current = await tx.reelProject.findUnique({
        where: { id: context.reelProjectId },
        select: { state: true },
      });
      if (
        !current ||
        (current.state !== "DRAFT" && current.state !== "REVISION_REQUESTED")
      ) {
        throw new ReelPlanningError(
          `ReelProject ${context.reelProjectId} is no longer plannable`,
          "REEL_PROJECT_NOT_PLANNABLE",
        );
      }

      const previous = await tx.reelVersion.findFirst({
        where: { reelProjectId: context.reelProjectId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (previous?.version ?? 0) + 1;

      const reelVersion = await tx.reelVersion.create({
        data: {
          reelProjectId: context.reelProjectId,
          version,
          blueprint: reelBlueprintJson(blueprint),
          caption: blueprint.caption,
          cta: blueprint.cta,
          createdByActorType: "AI",
          sources: {
            create: blueprint.clips.map((clip, order) => ({
              mediaAssetId: clip.mediaAssetId,
              order,
              inMs: clip.startMs,
              outMs: clip.endMs,
              role: clip.role,
            })),
          },
        },
        select: { id: true },
      });

      await tx.reelProject.update({
        where: { id: context.reelProjectId },
        data: { state: "PLANNED", activeVersion: version },
      });

      await tx.aiProvenance.create({
        data: {
          clientId: context.clientId,
          reelProjectId: context.reelProjectId,
          operation: "reel.plan",
          provider: result.provider,
          model: result.model,
          promptVersion,
          inputReference: {
            candidateCount: context.candidates.length,
            selectedSourceCount: blueprint.clips.length,
          },
          structuredOutput: reelBlueprintJson(blueprint),
          ...(result.confidence !== null
            ? { confidence: new Prisma.Decimal(result.confidence) }
            : {}),
          latencyMs,
        },
      });

      await tx.usageLedger.create({
        data: {
          clientId: context.clientId,
          reelProjectId: context.reelProjectId,
          kind: "AI",
          provider: result.provider,
          operation: "reel.plan",
          model: result.model,
          inputUnits: result.inputTokens,
          outputUnits: result.outputTokens,
          metadata: {
            reelVersionId: reelVersion.id,
            version,
            candidateCount: context.candidates.length,
            selectedSourceCount: blueprint.clips.length,
            latencyMs,
            promptVersion,
          },
        },
      });

      return { id: reelVersion.id, version };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  return {
    reelProjectId: context.reelProjectId,
    reelVersionId: persisted.id,
    version: persisted.version,
    blueprint,
    provider: result.provider,
    model: result.model,
  };
}
