import type { MembershipRole } from "@forge/database";

export const roleRank: Record<MembershipRole, number> = {
  OWNER: 70,
  ADMIN: 60,
  CONTENT_MANAGER: 50,
  EDITOR: 40,
  REVIEWER: 30,
  ANALYST: 20,
  VIEWER: 10,
};

export function hasMinimumRole(actual: MembershipRole, required: MembershipRole) {
  return roleRank[actual] >= roleRank[required];
}

export function assertOrganizationScope(
  expectedOrganizationId: string,
  resourceOrganizationId: string,
) {
  if (expectedOrganizationId !== resourceOrganizationId) {
    throw new Error("Resource is outside the active organization");
  }
}

export const CLIENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeClientSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
