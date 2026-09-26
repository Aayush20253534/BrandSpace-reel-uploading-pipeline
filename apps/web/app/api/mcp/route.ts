import { NextResponse, type NextRequest } from "next/server";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { env } from "@forge/config";
import {
  AgentRateLimitError,
  authenticateAgentToken,
  type AgentContext,
} from "../../../lib/mcp-auth";
import { createForgeMcpServer } from "../../../lib/mcp-server";

export const runtime = "nodejs";

type ForgeAuthInfo = AuthInfo & { forgeContext: AgentContext };
const handler = createMcpHandler(({ authInfo }) => {
  const context = (authInfo as ForgeAuthInfo | undefined)?.forgeContext;
  if (!context) throw new Error("Unauthenticated MCP request");
  return createForgeMcpServer(context);
});

function denied(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(status === 401
          ? { "www-authenticate": 'Bearer realm="BrandSpace Forge MCP"' }
          : {}),
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const appUrl = new URL(env.APP_URL);
  if (
    request.headers.get("host") !== appUrl.host ||
    (request.headers.has("origin") &&
      request.headers.get("origin") !== appUrl.origin)
  ) {
    return denied(403, "Invalid request origin");
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 128_000) return denied(413, "Request too large");

  try {
    const context = await authenticateAgentToken(
      request.headers.get("authorization"),
    );
    if (!context) return denied(401, "Invalid or expired bearer credential");

    const authInfo: ForgeAuthInfo = {
      token: context.credentialId,
      clientId: context.credentialId,
      scopes: context.scopes,
      forgeContext: context,
    };
    const response = await handler.fetch(request, { authInfo });
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof AgentRateLimitError) {
      return denied(429, "Agent request rate limit exceeded");
    }
    console.error("[mcp] request failed", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return denied(503, "MCP service unavailable");
  }
}

export function GET() {
  return denied(405, "Use MCP Streamable HTTP POST");
}

export function DELETE() {
  return denied(405, "This MCP endpoint is stateless");
}
