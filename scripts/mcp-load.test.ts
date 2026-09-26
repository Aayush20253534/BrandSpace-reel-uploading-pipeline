import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("MCP synthetic workload uses only read discovery and keeps its token out of output", async () => {
  const token = "bspf_test_secret_for_workload";
  let received = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/mcp");
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      method: string;
    };
    assert.equal(payload.method, "tools/list");
    received += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "scripts/mcp-load.ts"],
      {
        env: {
          ...process.env,
          MCP_LOAD_URL: `http://127.0.0.1:${address.port}/api/mcp`,
          MCP_LOAD_TOKEN: token,
          MCP_LOAD_REQUESTS: "3",
          MCP_LOAD_CONCURRENCY: "2",
        },
        timeout: 20_000,
      },
    );
    assert.equal(received, 3);
    assert.ok(!stdout.includes(token));
    assert.ok(!stderr.includes(token));
    const output = JSON.parse(stdout) as {
      requests: number;
      statuses: Record<string, number>;
    };
    assert.equal(output.requests, 3);
    assert.equal(output.statuses["200"], 3);
  } finally {
    server.close();
  }
});
