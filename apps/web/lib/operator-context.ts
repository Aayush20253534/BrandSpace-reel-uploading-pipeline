import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@forge/auth";
import { prisma, type MembershipRole } from "@forge/database";

export const operatorSections = [
  { id: "overview", label: "Overview", group: "Workspace", glyph: "◫" },
  { id: "media", label: "Media library", group: "Production", glyph: "▧" },
  { id: "projects", label: "Reel projects", group: "Production", glyph: "▤" },
  { id: "versions", label: "Versions", group: "Production", glyph: "◧" },
  { id: "render", label: "Render jobs", group: "Production", glyph: "◉" },
  { id: "qa", label: "Quality review", group: "Production", glyph: "◇" },
  { id: "approvals", label: "Approvals", group: "Review", glyph: "✓" },
  { id: "schedule", label: "Schedule", group: "Distribution", glyph: "▦" },
  {
    id: "publishing",
    label: "Publishing jobs",
    group: "Distribution",
    glyph: "↗",
  },
  {
    id: "accounts",
    label: "Account health",
    group: "Distribution",
    glyph: "◌",
  },
  { id: "analytics", label: "Analytics", group: "Intelligence", glyph: "▥" },
  { id: "audit", label: "Audit timeline", group: "System", glyph: "≡" },
] as const;

export type OperatorSection = (typeof operatorSections)[number]["id"];
export type Query = Record<string, string | string[] | undefined>;

const analystSections: readonly OperatorSection[] = ["analytics"];
const reviewerSections: readonly OperatorSection[] = [
  "overview",
  "projects",
  "versions",
  "qa",
  "approvals",
];
const editorSections: readonly OperatorSection[] = [
  "overview",
  "media",
  "projects",
  "versions",
  "render",
  "qa",
  "approvals",
];

export function canViewSection(role: MembershipRole, section: OperatorSection) {
  if (role === "ANALYST") return analystSections.includes(section);
  if (role === "REVIEWER") return reviewerSections.includes(section);
  if (role === "EDITOR") return editorSections.includes(section);
  return true;
}

export function parseSection(value: string): OperatorSection | null {
  return operatorSections.find((section) => section.id === value)?.id ?? null;
}

export function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function operatorHref(
  section: OperatorSection,
  organizationId: string,
  clientId: string | null,
  page?: number,
) {
  const params = new URLSearchParams({ organizationId });
  if (clientId) params.set("clientId", clientId);
  if (page && page > 1) params.set("page", String(page));
  return `${section === "overview" ? "/dashboard" : `/dashboard/${section}`}?${params}`;
}

export async function getOperatorContext(query: Query) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const memberships = await prisma.membership.findMany({
    where: { userId: session.user.id },
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const requestedOrganizationId = firstQueryValue(query.organizationId);
  const membership = requestedOrganizationId
    ? memberships.find(
        (item) => item.organization.id === requestedOrganizationId,
      )
    : memberships[0];
  if (requestedOrganizationId && !membership) notFound();

  const clients = membership
    ? await prisma.client.findMany({
        where: { organizationId: membership.organization.id },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          timezone: true,
        },
        orderBy: { name: "asc" },
      })
    : [];
  const requestedClientId = firstQueryValue(query.clientId);
  const client = requestedClientId
    ? clients.find((item) => item.id === requestedClientId)
    : clients[0];
  if (requestedClientId && !client) notFound();

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    memberships: memberships.map((item) => ({
      role: item.role,
      organization: item.organization,
    })),
    membership: membership ?? null,
    clients,
    client: client ?? null,
  };
}

export type OperatorContext = Awaited<ReturnType<typeof getOperatorContext>>;
