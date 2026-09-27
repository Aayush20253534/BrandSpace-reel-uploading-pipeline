import assert from "node:assert/strict";
import test from "node:test";
import {
  nextInsightsCapture,
  parseInsightsMetrics,
} from "./instagram-insights.js";

test("insights metric names must be an explicit bounded allowlist", () => {
  assert.deepEqual(parseInsightsMetrics("views, reach"), ["views", "reach"]);
  assert.throws(() => parseInsightsMetrics(undefined));
  assert.throws(() => parseInsightsMetrics("views,views"));
  assert.throws(() => parseInsightsMetrics("views,access_token=secret"));
});

test("insights captures have a finite thirty-day window", () => {
  const published = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(
    nextInsightsCapture(
      published,
      new Date("2026-09-02T00:00:00.000Z"),
    )?.toISOString(),
    "2026-09-02T06:00:00.000Z",
  );
  assert.equal(
    nextInsightsCapture(
      published,
      new Date("2026-09-10T00:00:00.000Z"),
    )?.toISOString(),
    "2026-09-11T00:00:00.000Z",
  );
  assert.equal(
    nextInsightsCapture(published, new Date("2026-10-01T00:00:00.000Z")),
    null,
  );
});
