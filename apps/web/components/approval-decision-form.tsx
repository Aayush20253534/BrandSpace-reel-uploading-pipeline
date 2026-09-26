"use client";

import { useActionState } from "react";
import {
  recordApprovalDecision,
  type DecisionActionState,
} from "../app/dashboard/actions";

const initialState: DecisionActionState = { ok: null, message: "" };

export function ApprovalDecisionForm({
  approvalId,
  organizationId,
  clientId,
  projectTitle,
}: {
  approvalId: string;
  organizationId: string;
  clientId: string;
  projectTitle: string;
}) {
  const [state, action, pending] = useActionState(
    recordApprovalDecision,
    initialState,
  );
  return (
    <form action={action} aria-label={`Decision for ${projectTitle}`}>
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="clientId" value={clientId} />
      <label className="sr-only" htmlFor={`note-${approvalId}`}>
        Decision note
      </label>
      <input
        id={`note-${approvalId}`}
        name="note"
        maxLength={2_000}
        placeholder="Optional note"
        className="mb-2 w-[220px] rounded-md border border-[#d8e2e2] bg-white px-2 py-1 text-[11px]"
      />
      <div className="flex gap-1">
        <button
          type="submit"
          name="action"
          value="approve"
          disabled={pending}
          className="rounded-md bg-[#0f6b64] px-2 py-1 text-[11px] font-bold text-white disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="submit"
          name="action"
          value="revision"
          disabled={pending}
          className="rounded-md border border-[#d8e2e2] px-2 py-1 text-[11px] font-bold text-[#52646c] disabled:opacity-60"
        >
          Revise
        </button>
        <button
          type="submit"
          name="action"
          value="reject"
          disabled={pending}
          className="rounded-md border border-[#efc1bc] px-2 py-1 text-[11px] font-bold text-[#a13e3b] disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      {state.ok !== null && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-2 mb-0 text-[11px] ${state.ok ? "text-[#126553]" : "text-[#a13e3b]"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
