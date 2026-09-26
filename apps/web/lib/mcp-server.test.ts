import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { MembershipRole } from "@forge/database";
import { createForgeMcpServer } from "./mcp-server";

async function toolNames(role: MembershipRole) {
  const handler = createMcpHandler(() =>
    createForgeMcpServer({
      credentialId: "credential-test",
      userId: "user-test",
      organizationId: "organization-test",
      clientId: null,
      role,
    }),
  );
  try {
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      }),
    );
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const payload = JSON.parse(body) as {
      result: { tools: Array<{ name: string }> };
    };
    return payload.result.tools.map((tool) => tool.name);
  } finally {
    await handler.close();
  }
}

test("MCP tool discovery keeps analysts within analytics and client selection", async () => {
  assert.deepEqual(await toolNames("ANALYST"), [
    "list_clients",
    "list_analytics_snapshots",
  ]);
});

test("MCP tool discovery exposes no mutation or credential tools", async () => {
  const names = await toolNames("OWNER");
  assert.ok(names.includes("list_social_account_health"));
  assert.ok(names.includes("list_audit_events"));
  assert.ok(
    names.every((name) => name.startsWith("list_") || name.startsWith("get_")),
  );
});

test("reviewers cannot discover account, analytics, or audit tools", async () => {
  const names = await toolNames("REVIEWER");
  assert.ok(names.includes("list_approvals"));
  assert.ok(!names.includes("list_social_account_health"));
  assert.ok(!names.includes("list_analytics_snapshots"));
  assert.ok(!names.includes("list_audit_events"));
});
