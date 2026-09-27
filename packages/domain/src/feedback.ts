export const REEL_FEEDBACK_SCHEMA_VERSION = "reel-feedback-v1" as const;

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface FeedbackSource {
  mediaAssetId: string;
  order: number;
  role: string | null;
  inMs: number | null;
  outMs: number | null;
}

export interface FeedbackPublishingJob {
  state: string;
  scheduledAt: Date;
  publishedAt: Date | null;
}

export function extractReelFeatures(input: {
  blueprint: unknown;
  sources: FeedbackSource[];
  objective: string | null;
  campaignKey: string | null;
  timezone: string;
  publishingJob?: FeedbackPublishingJob;
}) {
  const blueprint = isRecord(input.blueprint) ? input.blueprint : {};
  const targetDurationMs =
    typeof blueprint.targetDurationMs === "number" &&
    Number.isInteger(blueprint.targetDurationMs) &&
    blueprint.targetDurationMs > 0
      ? blueprint.targetDurationMs
      : null;
  const durationBand =
    targetDurationMs === null
      ? "UNKNOWN"
      : targetDurationMs < 15_000
        ? "UNDER_15S"
        : targetDurationMs <= 30_000
          ? "15_TO_30S"
          : "OVER_30S";
  const hook = typeof blueprint.hook === "string" ? blueprint.hook.trim() : "";
  const caption =
    typeof blueprint.caption === "string" ? blueprint.caption.trim() : "";
  const cta = typeof blueprint.cta === "string" ? blueprint.cta.trim() : "";
  const ctaCategory = /^\s*(?:save|bookmark)\b/i.test(cta)
    ? "SAVE"
    : /^\s*(?:share|send)\b/i.test(cta)
      ? "SHARE"
      : /^\s*(?:comment|reply)\b/i.test(cta)
        ? "COMMENT"
        : /^\s*(?:follow|subscribe)\b/i.test(cta)
          ? "FOLLOW"
          : /^\s*(?:visit|click|tap|shop|book|sign up)\b/i.test(cta)
            ? "VISIT_OR_CONVERT"
            : cta
              ? "UNCLASSIFIED"
              : "ABSENT";
  const orderedSources = [...input.sources].sort(
    (a, b) => a.order - b.order || a.mediaAssetId.localeCompare(b.mediaAssetId),
  );
  const sourceAssetIds = [
    ...new Set(orderedSources.map((source) => source.mediaAssetId)),
  ];
  const clipDurations = orderedSources.map((source) =>
    source.inMs !== null && source.outMs !== null && source.outMs > source.inMs
      ? source.outMs - source.inMs
      : null,
  );
  const averageClipMs =
    clipDurations.length > 0 &&
    clipDurations.every((duration) => duration !== null)
      ? Math.round(
          clipDurations.reduce<number>(
            (sum, duration) => sum + (duration ?? 0),
            0,
          ) / clipDurations.length,
        )
      : null;
  const clipsPerMinute =
    targetDurationMs !== null
      ? Math.round((orderedSources.length * 60_000 * 100) / targetDurationMs) /
        100
      : null;
  const postingAt = input.publishingJob?.publishedAt ?? null;
  let postingHourLocal: number | null = null;
  if (postingAt) {
    try {
      const hour = new Intl.DateTimeFormat("en-US", {
        timeZone: input.timezone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(postingAt);
      postingHourLocal = Number(hour);
    } catch {
      // Invalid historic client timezones leave this derived field unknown.
    }
  }

  return {
    schemaVersion: REEL_FEEDBACK_SCHEMA_VERSION,
    targetDurationMs,
    durationBand,
    hookText: hook || null,
    hookSurfaceForm: hook.endsWith("?")
      ? "QUESTION_PUNCTUATION"
      : "UNCLASSIFIED",
    captionPresent: Boolean(caption),
    ctaPresent: Boolean(cta),
    ctaText: cta || null,
    ctaCategory,
    clipCount: orderedSources.length,
    sourceAssetIds,
    sectionRoles: orderedSources.map((source) => source.role),
    averageClipMs,
    clipsPerMinute,
    objective:
      typeof blueprint.objective === "string"
        ? blueprint.objective
        : input.objective,
    objectiveProvenance:
      typeof blueprint.objective === "string"
        ? "IMMUTABLE_BLUEPRINT"
        : "CURRENT_PROJECT_AT_SYNC",
    campaignKeyAtSync: input.campaignKey,
    contentPillar: "UNLABELED",
    subtitleUsage: "UNRECORDED",
    publishingStateAtSync: input.publishingJob?.state ?? null,
    scheduledAt: input.publishingJob?.scheduledAt.toISOString() ?? null,
    publishedAt: postingAt?.toISOString() ?? null,
    postingTimezone: input.timezone,
    postingHourLocal,
  };
}
