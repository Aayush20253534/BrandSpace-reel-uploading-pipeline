export interface PublishingPreflight {
  jobState: string;
  jobProjectId: string;
  jobVersionId: string;
  jobAccountId: string;
  project: {
    id: string;
    state: string;
    activeVersion: number;
    clientId: string;
    approvalMode: string;
  };
  version: {
    id: string;
    reelProjectId: string;
    version: number;
    renderedAssetId: string | null;
  };
  account: {
    id: string;
    clientId: string;
    status: string;
    hasCredential: boolean;
    tokenExpiresAt: Date | null;
  };
  hasVersionApproval: boolean;
}

export function publishingPreflightError(
  input: PublishingPreflight,
  now = new Date(),
): string | null {
  if (input.jobState !== "SCHEDULED" && input.jobState !== "RETRY_WAIT") {
    return "JOB_NOT_PENDING";
  }
  if (
    input.project.id !== input.jobProjectId ||
    input.project.state !== "SCHEDULED" ||
    input.version.id !== input.jobVersionId ||
    input.version.reelProjectId !== input.jobProjectId ||
    input.project.activeVersion !== input.version.version
  ) {
    return "ACTIVE_VERSION_CHANGED";
  }
  if (!input.version.renderedAssetId) return "RENDERED_ARTIFACT_MISSING";
  if (
    input.account.id !== input.jobAccountId ||
    input.account.clientId !== input.project.clientId
  ) {
    return "SOCIAL_ACCOUNT_SCOPE_CHANGED";
  }
  if (
    input.account.status !== "CONNECTED" ||
    !input.account.hasCredential ||
    (input.account.tokenExpiresAt !== null &&
      input.account.tokenExpiresAt.getTime() <= now.getTime())
  ) {
    return "SOCIAL_ACCOUNT_NOT_READY";
  }
  if (input.project.approvalMode !== "AUTO" && !input.hasVersionApproval) {
    return "VERSION_APPROVAL_MISSING";
  }
  return null;
}
