export const TECHNICAL_QA_VERSION = "technical-qa-v1" as const;

export interface TechnicalQaInput {
  expectedDurationMs: number;
  actualDurationMs: number | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  sizeBytes: bigint | number | null;
  hasVideo: boolean | null;
  hasAudio: boolean | null;
}

export interface TechnicalQaCheck {
  key: string;
  pass: boolean;
  actual: string | number | boolean | null;
  expected: string;
}

export interface TechnicalQaResult {
  version: typeof TECHNICAL_QA_VERSION;
  pass: boolean;
  checks: TechnicalQaCheck[];
}

const durationToleranceMs = (expectedDurationMs: number) =>
  Math.max(250, Math.round(expectedDurationMs * 0.05));

export function runTechnicalQa(input: TechnicalQaInput): TechnicalQaResult {
  const toleranceMs = durationToleranceMs(input.expectedDurationMs);
  const durationDelta =
    input.actualDurationMs === null
      ? null
      : Math.abs(input.actualDurationMs - input.expectedDurationMs);
  const size =
    typeof input.sizeBytes === "bigint"
      ? Number(input.sizeBytes)
      : input.sizeBytes;

  const checks: TechnicalQaCheck[] = [
    {
      key: "mimeType",
      pass: input.mimeType === "video/mp4",
      actual: input.mimeType,
      expected: "video/mp4",
    },
    {
      key: "nonEmpty",
      pass: size !== null && Number.isSafeInteger(size) && size > 0,
      actual: size,
      expected: "> 0 bytes",
    },
    {
      key: "dimensions",
      pass: input.width === 1080 && input.height === 1920,
      actual:
        input.width === null || input.height === null
          ? null
          : `${input.width}x${input.height}`,
      expected: "1080x1920",
    },
    {
      key: "duration",
      pass: durationDelta !== null && durationDelta <= toleranceMs,
      actual: input.actualDurationMs,
      expected: `${input.expectedDurationMs}ms ± ${toleranceMs}ms`,
    },
    {
      key: "videoStream",
      pass: input.hasVideo === true,
      actual: input.hasVideo,
      expected: "true",
    },
    {
      key: "audioStream",
      pass: input.hasAudio === true,
      actual: input.hasAudio,
      expected: "true",
    },
  ];

  return {
    version: TECHNICAL_QA_VERSION,
    pass: checks.every((check) => check.pass),
    checks,
  };
}

export function nextStateAfterQaPass(
  approvalMode: "REQUIRED" | "OPTIONAL" | "AUTO",
): "AWAITING_APPROVAL" | "APPROVED" {
  return approvalMode === "AUTO" ? "APPROVED" : "AWAITING_APPROVAL";
}

export const CREATIVE_QA_VERSION = "creative-qa-v1" as const;

export interface CreativeQaInput {
  hook: string | null;
  caption: string | null;
  cta: string | null;
  clipPurposes: string[];
  bannedWords: string[];
  forbiddenTopics: string[];
}

export interface CreativeQaCheck {
  key: string;
  pass: boolean;
  detail: string;
  matches?: string[];
}

export interface CreativeQaResult {
  version: typeof CREATIVE_QA_VERSION;
  pass: boolean;
  checks: CreativeQaCheck[];
}

const normalizedTerms = (values: string[]) => [
  ...new Set(
    values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean),
  ),
];

export function runCreativeQa(input: CreativeQaInput): CreativeQaResult {
  const generatedText = [
    input.hook,
    input.caption,
    input.cta,
    ...input.clipPurposes,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLocaleLowerCase();

  const bannedMatches = normalizedTerms(input.bannedWords).filter((term) =>
    generatedText.includes(term),
  );
  const forbiddenMatches = normalizedTerms(input.forbiddenTopics).filter(
    (term) => generatedText.includes(term),
  );

  const checks: CreativeQaCheck[] = [
    {
      key: "hookPresent",
      pass: Boolean(input.hook?.trim()),
      detail: "Blueprint hook must be present",
    },
    {
      key: "clipPurposesPresent",
      pass:
        input.clipPurposes.length > 0 &&
        input.clipPurposes.every((purpose) => Boolean(purpose.trim())),
      detail: "Every selected clip must have a non-empty creative purpose",
    },
    {
      key: "bannedWords",
      pass: bannedMatches.length === 0,
      detail: "Generated reel text must not contain banned brand wording",
      ...(bannedMatches.length > 0 ? { matches: bannedMatches } : {}),
    },
    {
      key: "forbiddenTopics",
      pass: forbiddenMatches.length === 0,
      detail:
        "Generated reel text must not explicitly contain forbidden topics",
      ...(forbiddenMatches.length > 0 ? { matches: forbiddenMatches } : {}),
    },
  ];

  return {
    version: CREATIVE_QA_VERSION,
    pass: checks.every((check) => check.pass),
    checks,
  };
}
