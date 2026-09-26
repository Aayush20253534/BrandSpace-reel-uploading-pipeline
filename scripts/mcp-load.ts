// Read-only synthetic workload for a staging MCP endpoint. Never prints the token
// or response body, which may contain client data.
export {};

const endpoint = process.env.MCP_LOAD_URL;
const token = process.env.MCP_LOAD_TOKEN;
if (!endpoint || !token) {
  throw new Error(
    "Set MCP_LOAD_URL and MCP_LOAD_TOKEN in the operator environment",
  );
}

const url = new URL(endpoint);
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  )
) {
  throw new Error("MCP_LOAD_URL must use HTTPS or localhost HTTP");
}
if (url.pathname !== "/api/mcp") {
  throw new Error("MCP_LOAD_URL must point to /api/mcp");
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(`Workload value must be an integer from 1 to ${max}`);
  }
  return number;
}

const requestCount = boundedInteger(process.env.MCP_LOAD_REQUESTS, 20, 100);
const concurrency = boundedInteger(process.env.MCP_LOAD_CONCURRENCY, 2, 10);
const durations: number[] = [];
const statuses = new Map<number, number>();
let nextRequest = 0;

async function worker() {
  for (;;) {
    const id = nextRequest++;
    if (id >= requestCount) return;
    const startedAt = performance.now();
    let status: number;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: id + 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      await response.arrayBuffer();
    } catch {
      status = 0;
    }
    durations.push(performance.now() - startedAt);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  }
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0);
}

async function main() {
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write(
    JSON.stringify({
      requests: requestCount,
      concurrency,
      statuses: Object.fromEntries(statuses),
      latencyMs: {
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: Math.round(Math.max(...durations)),
      },
    }) + "\n",
  );
}

main().catch(() => {
  process.stderr.write("MCP synthetic workload failed\n");
  process.exitCode = 1;
});
