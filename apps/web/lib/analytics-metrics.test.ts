import assert from "node:assert/strict";
import test from "node:test";
import { providerCollectedAt, providerMetricValues } from "./analytics-metrics";

test("dashboard shows only provider-returned numeric insight values", () => {
  const metrics = {
    schemaVersion: "instagram-insights-v1",
    collectedAt: "2026-09-27T00:00:00.000Z",
    providerData: [
      { name: "views", values: [{ value: 120 }] },
      { name: "reach", total_value: { value: 80 } },
      { name: "unknown", values: [{ value: "unsupported" }] },
    ],
  };
  assert.deepEqual(providerMetricValues(metrics), [
    ["views", 120],
    ["reach", 80],
  ]);
  assert.equal(
    providerCollectedAt(metrics)?.toISOString(),
    "2026-09-27T00:00:00.000Z",
  );
  assert.deepEqual(providerMetricValues({ views: 7 }), [["views", 7]]);
});
