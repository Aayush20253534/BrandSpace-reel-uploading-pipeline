import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { type ReelPlanningContext } from "./index";
import { GroqReelPlanningProvider } from "./groq";

const context: ReelPlanningContext = {
  reelProjectId: "project-1",
  clientId: "client-1",
  title: "Dental education",
  objective: "Explain accurate diagnosis",
  brand: null,
  candidates: [
    {
      mediaAssetId: "asset-1",
      sceneIndex: 7,
      startMs: 31467,
      endMs: 35633,
      durationMs: 4166,
      score: 0.7166,
      summary: "Dentist explains preserving natural teeth",
      transcript: "Preserve your natural tooth with precision and care.",
      tags: ["dental care"],
      subjects: ["dentist"],
    },
  ],
};

const validContent = JSON.stringify({
  targetDurationMs: 4166,
  hook: "Accurate diagnosis is where treatment begins.",
  caption: "Precision and care start with the right diagnosis.",
  cta: null,
  clips: [
    {
      candidateId: "asset-1:scene:7",
      role: "HOOK",
      purpose: "Open on the strongest educational source segment",
    },
  ],
});

const fakeClient = (content: string | null) =>
  ({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        }),
      },
    },
  }) as unknown as OpenAI;

test("Groq provider returns a normalized strict reel blueprint", async () => {
  const result = await new GroqReelPlanningProvider(
    fakeClient(validContent),
  ).plan(context);
  assert.equal(result.provider, "groq");
  assert.equal(result.model, "qwen/qwen3.8-27b");
  assert.equal(result.inputTokens, 120);
  assert.equal(result.outputTokens, 80);
  assert.equal(result.blueprint.title, context.title);
  assert.equal(result.blueprint.objective, context.objective);
  assert.equal(result.blueprint.clips[0]?.mediaAssetId, "asset-1");
  assert.equal(result.blueprint.clips[0]?.startMs, 31467);
});

test("Groq provider rejects malformed output", async () => {
  const invalid = JSON.stringify({
    ...JSON.parse(validContent),
    targetDurationMs: "4166",
  });
  await assert.rejects(
    () => new GroqReelPlanningProvider(fakeClient(invalid)).plan(context),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REEL_PROVIDER_OUTPUT_INVALID",
  );
});

test("Groq provider rejects empty content", async () => {
  await assert.rejects(
    () => new GroqReelPlanningProvider(fakeClient(null)).plan(context),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REEL_PROVIDER_OUTPUT_EMPTY",
  );
});

test("Groq provider rejects an invented candidate id", async () => {
  const invalid = JSON.stringify({
    ...JSON.parse(validContent),
    clips: [
      {
        candidateId: "asset-1:scene:999",
        role: "HOOK",
        purpose: "Invented source",
      },
    ],
  });

  await assert.rejects(
    () => new GroqReelPlanningProvider(fakeClient(invalid)).plan(context),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REEL_PROVIDER_SOURCE_INVALID",
  );
});

test("Groq provider resolves source boundaries deterministically", async () => {
  const result = await new GroqReelPlanningProvider(
    fakeClient(validContent),
  ).plan(context);
  assert.equal(result.blueprint.clips[0]?.sceneIndex, 7);
  assert.equal(result.blueprint.clips[0]?.startMs, 31467);
  assert.equal(result.blueprint.clips[0]?.endMs, 35633);
});
