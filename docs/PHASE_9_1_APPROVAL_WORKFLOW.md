# Phase 9.1 — Durable Human Approval Workflow

Phase 9.1 turns the existing `AWAITING_APPROVAL` state into a durable, auditable
human decision boundary.

## Request

`reel:approval request` requires:

- a project in `AWAITING_APPROVAL`;
- a non-`AUTO` approval mode;
- the active reel version;
- a passing QA review with both technical and creative results.

Only one pending approval request is reused for repeated invocations.

## Decision

A pending approval can be decided as:

- `approve` → `APPROVED`;
- `revision` → `REVISION_REQUESTED`;
- `reject` → `REJECTED`.

The approval row and project transition are committed in one serializable transaction.
The first decision wins. Repeating the same decision returns the durable result;
a conflicting later decision is rejected.

Every new request and decision writes an `AuditEvent` with the acting user identifier.

## Commands

```powershell
npm run reel:approval -- request <reel-project-id> <actor-id>
npm run reel:approval -- decide <approval-id> approve <actor-id> "Approved for publishing"
npm run reel:approval -- decide <approval-id> revision <actor-id> "Change the hook"
npm run reel:approval -- decide <approval-id> reject <actor-id> "Do not publish"
```

The CLI is an operator acceptance surface. The dashboard/API can call the same durable
domain rules in later phases.
