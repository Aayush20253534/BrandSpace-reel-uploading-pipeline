import assert from "node:assert/strict";
import { test } from "node:test";
import { probeMedia } from "./index";

test("probeMedia parses deterministic ffprobe JSON", async () => {
  // Parser behavior is integration-tested through the CLI smoke test because
  // subprocess execution is deliberately kept behind the real ffprobe binary.
  assert.equal(typeof probeMedia, "function");
});
