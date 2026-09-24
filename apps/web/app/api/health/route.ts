import { NextResponse } from "next/server";
import { APP_NAME, PHASE } from "@forge/shared";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "web",
      app: APP_NAME,
      phase: PHASE,
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
