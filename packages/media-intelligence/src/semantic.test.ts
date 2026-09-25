import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedFrame } from "./index";
import type {
  SemanticAnalysisProvider,
  SemanticUnderstanding,
} from "./semantic";

test("semantic analysis provider contract is provider-neutral", async () => {
  const expected: SemanticUnderstanding = {
    summary: "A dentist explains accurate diagnosis before root-canal care.",
    tags: ["dentistry", "root canal"],
    subjects: ["dentist"],
    visual: {
      setting: "dental clinic",
      peopleCount: 1,
      shotType: "talking head",
      lighting: "bright indoor",
      dominantColors: ["white", "blue"],
      onScreenText: [],
      objects: ["dental chair"],
      actions: ["speaking to camera"],
    },
    content: {
      topic: "root canal treatment",
      hook: "accurate diagnosis is where everything begins",
      cta: null,
      contentType: "educational",
      mood: "professional",
    },
    quality: {
      clarity: 0.9,
      framing: 0.8,
      lighting: 0.85,
      audio: 0.9,
      overall: 0.86,
      issues: [],
    },
    semanticSegments: [
      {
        sceneIndex: 0,
        startMs: 0,
        endMs: 2667,
        description: "Dentist introduces the diagnostic premise.",
        spokenContext: "Accurate diagnosis is where everything begins.",
        relevanceScore: 0.9,
      },
    ],
    provider: "fake",
    model: "fake-vision-v1",
    inputTokens: 100,
    outputTokens: 50,
  };

  const provider: SemanticAnalysisProvider = {
    name: "fake",
    model: "fake-vision-v1",
    analyze: async (input) => {
      assert.equal(input.frames.length, 1);
      assert.equal(input.scenes.length, 1);
      assert.match(input.transcript ?? "", /diagnosis/i);
      return expected;
    },
  };

  const frames: PreparedFrame[] = [
    { index: 0, timestampMs: 1200, path: "frame-01.jpg" },
  ];
  const result = await provider.analyze({
    frames,
    transcript: "Accurate diagnosis is where everything begins.",
    language: "English",
    scenes: [
      {
        index: 0,
        startMs: 0,
        endMs: 2667,
        durationMs: 2667,
        confidence: 0.327295,
      },
    ],
  });

  assert.deepEqual(result, expected);
});
