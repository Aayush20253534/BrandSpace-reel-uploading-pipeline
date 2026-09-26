import type { MembershipRole } from "@forge/database";
export {
  approvalActionResult,
  type ApprovalAction,
} from "./approval-policy.js";

export const roleRank: Record<MembershipRole, number> = {
  OWNER: 70,
  ADMIN: 60,
  CONTENT_MANAGER: 50,
  EDITOR: 40,
  REVIEWER: 30,
  ANALYST: 20,
  VIEWER: 10,
};

export function hasMinimumRole(
  actual: MembershipRole,
  required: MembershipRole,
) {
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

export const REEL_PROJECT_TRANSITIONS = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["RENDERING", "DRAFT", "CANCELLED"],
  RENDERING: ["QA", "RENDER_FAILED", "CANCELLED"],
  QA: ["AWAITING_APPROVAL", "APPROVED", "RENDERING", "CANCELLED"],
  AWAITING_APPROVAL: [
    "APPROVED",
    "REVISION_REQUESTED",
    "REJECTED",
    "CANCELLED",
  ],
  REVISION_REQUESTED: ["PLANNED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["PUBLISHING", "APPROVED", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "PUBLISH_FAILED"],
  PUBLISHED: [],
  REJECTED: ["PLANNED", "CANCELLED"],
  RENDER_FAILED: ["RENDERING", "CANCELLED"],
  PUBLISH_FAILED: ["SCHEDULED", "PUBLISHING", "CANCELLED"],
  CANCELLED: [],
} as const;

export type ReelProjectState = keyof typeof REEL_PROJECT_TRANSITIONS;

export function canTransitionReelProject(
  from: ReelProjectState,
  to: ReelProjectState,
) {
  return (REEL_PROJECT_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function assertReelProjectTransition(
  from: ReelProjectState,
  to: ReelProjectState,
) {
  if (!canTransitionReelProject(from, to)) {
    throw new Error(`Invalid ReelProject transition: ${from} -> ${to}`);
  }
}

export function buildPublishingIdempotencyKey(
  reelVersionId: string,
  socialAccountId: string,
  scheduledAt: Date,
) {
  return `${reelVersionId}:${socialAccountId}:${scheduledAt.toISOString()}`;
}
