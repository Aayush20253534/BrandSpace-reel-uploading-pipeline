import { NextResponse } from "next/server";
import { prisma } from "@forge/database";
import { requireSession } from "../../../lib/auth-session";

export async function GET() {
  try {
    const session = await requireSession();
    const memberships = await prisma.membership.findMany({
      where: { userId: session.user.id },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      user: session.user,
      organizations: memberships.map(({ organization, role }) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
}
