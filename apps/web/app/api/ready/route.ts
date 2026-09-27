import { NextResponse } from "next/server";
import { prisma } from "@forge/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ready", service: "web" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", service: "web" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
