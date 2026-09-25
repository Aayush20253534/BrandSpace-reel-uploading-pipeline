import assert from "node:assert/strict";
import test from "node:test";
import { nextStateAfterQaPass, runCreativeQa, runTechnicalQa } from "./index";

test("passes a valid vertical reel within duration tolerance", () => {
  const result = runTechnicalQa({
    expectedDurationMs: 8467,
    actualDurationMs: 8533,
    width: 1080,
    height: 1920,
    mimeType: "video/mp4",
    sizeBytes: 3_740_278n,
    hasVideo: true,
    hasAudio: true,
  });
  assert.equal(result.pass, true);
  assert.equal(
    result.checks.every((check) => check.pass),
    true,
  );
});

test("fails malformed render metadata without throwing", () => {
  const result = runTechnicalQa({
    expectedDurationMs: 8000,
    actualDurationMs: 10000,
    width: 720,
    height: 1280,
    mimeType: "video/quicktime",
    sizeBytes: 0,
    hasVideo: true,
    hasAudio: false,
  });
  assert.equal(result.pass, false);
  assert.equal(result.checks.filter((check) => !check.pass).length, 5);
});

test("routes AUTO approval directly to approved", () => {
  assert.equal(nextStateAfterQaPass("AUTO"), "APPROVED");
  assert.equal(nextStateAfterQaPass("REQUIRED"), "AWAITING_APPROVAL");
  assert.equal(nextStateAfterQaPass("OPTIONAL"), "AWAITING_APPROVAL");
});

test("passes deterministic creative brand-policy checks", () => {
  const result = runCreativeQa({
    hook: "A calmer dental visit starts with the right care",
    caption: "A short educational reel",
    cta: "Book a consultation",
    clipPurposes: ["Introduce the clinician", "Show the treatment environment"],
    bannedWords: ["guaranteed"],
    forbiddenTopics: ["politics"],
  });
  assert.equal(result.pass, true);
});

test("flags banned wording and explicitly forbidden topics", () => {
  const result = runCreativeQa({
    hook: "Guaranteed political results",
    caption: null,
    cta: null,
    clipPurposes: ["Explain the service"],
    bannedWords: ["guaranteed"],
    forbiddenTopics: ["political"],
  });
  assert.equal(result.pass, false);
  assert.deepEqual(
    result.checks.filter((check) => !check.pass).map((check) => check.key),
    ["bannedWords", "forbiddenTopics"],
  );
});
