import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  TranscriptionProvider,
  TranscriptionResult,
} from "./transcription";

test("transcription provider contract is provider-neutral", async () => {
  const provider: TranscriptionProvider = {
    name: "test",
    model: "test-model",
    async transcribe(): Promise<TranscriptionResult> {
      return {
        text: "hello world",
        language: "en",
        durationMs: 1000,
        segments: [{ startMs: 0, endMs: 1000, text: "hello world" }],
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result = await provider.transcribe({ audioPath: "unused.wav" });
  assert.equal(result.text, "hello world");
  assert.equal(result.language, "en");
  assert.equal(result.segments.length, 1);
});
