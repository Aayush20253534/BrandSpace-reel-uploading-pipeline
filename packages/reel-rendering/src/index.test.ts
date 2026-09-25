import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRenderArguments,
  DEFAULT_REEL_RENDER_PROFILE,
  validateRenderSources,
} from "./index";

test("builds deterministic vertical H264/AAC render arguments", () => {
  const args = buildRenderArguments({
    sources: [
      {
        path: "source.mp4",
        startMs: 1000,
        endMs: 3500,
        hasAudio: true,
      },
    ],
    outputPath: "out.mp4",
  });
  const command = args.join(" ");
  assert.match(command, /trim=start=1\.000:end=3\.500/);
  assert.match(command, /scale=1080:1920/);
  assert.match(command, /concat=n=1:v=1:a=1/);
  assert.match(command, /-c:v libx264/);
  assert.match(command, /-c:a aac/);
  assert.equal(DEFAULT_REEL_RENDER_PROFILE.width, 1080);
  assert.equal(DEFAULT_REEL_RENDER_PROFILE.height, 1920);
});

test("synthesizes silence for video without audio", () => {
  const args = buildRenderArguments({
    sources: [
      {
        path: "silent.mp4",
        startMs: 0,
        endMs: 2000,
        hasAudio: false,
      },
    ],
    outputPath: "out.mp4",
  });
  assert.match(args.join(" "), /anullsrc=r=48000:cl=stereo/);
});

test("rejects invalid source boundaries", () => {
  assert.throws(
    () =>
      validateRenderSources([
        { path: "source.mp4", startMs: 2000, endMs: 1000, hasAudio: true },
      ]),
    /Invalid source clip/,
  );
});
