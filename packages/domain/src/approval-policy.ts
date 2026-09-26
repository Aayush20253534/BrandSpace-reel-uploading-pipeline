export type ApprovalAction = "approve" | "revision" | "reject";

export function approvalActionResult(action: ApprovalAction): {
  decision: "APPROVED" | "REVISION_REQUESTED" | "REJECTED";
  projectState: "APPROVED" | "REVISION_REQUESTED" | "REJECTED";
} {
  switch (action) {
    case "approve":
      return { decision: "APPROVED", projectState: "APPROVED" };
    case "revision":
      return {
        decision: "REVISION_REQUESTED",
        projectState: "REVISION_REQUESTED",
      };
    case "reject":
      return { decision: "REJECTED", projectState: "REJECTED" };
  }
}
