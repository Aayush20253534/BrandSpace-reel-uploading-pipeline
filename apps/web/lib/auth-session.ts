import { headers } from "next/headers";
import { auth } from "@forge/auth";
import { prisma, type MembershipRole } from "@forge/database";

export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}

export async function requireOrganizationMembership(organizationId: string) {
  const session = await requireSession();
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: session.user.id,
      },
    },
  });
  if (!membership) throw new Error("FORBIDDEN");
  return { session, membership };
}

export async function requireRole(
  organizationId: string,
  allowed: readonly MembershipRole[],
) {
  const context = await requireOrganizationMembership(organizationId);
  if (!allowed.includes(context.membership.role)) throw new Error("FORBIDDEN");
  return context;
}
