# Version-bound approval hardening

The `Approval.reelVersionId` relation binds every new review request to the
exact immutable `ReelVersion` that passed QA. Decisions reject a pending
approval if its version is missing, belongs to another project, or is no longer
active. They also require the generated Drive artifact to remain ready. The
project state update checks the active version atomically. The dashboard and CLI
share the same decision transaction.

Scheduling a non-`AUTO` client now requires an `APPROVED` record for the active
version. The dispatch worker checks the same approval, project/version identity,
rendered artifact and client-scoped account readiness before claiming a queue
job. Failed preflight moves pending work to `NEEDS_ATTENTION` with a stable code
and audit event. Its final state claim repeats mutable conditions in SQL.

The migration backfills legacy approval versions only when their request audit
event contains one unambiguous `reelVersionId` belonging to the same project.
Unbound rows remain null and cannot authorize scheduling. The `reopen` operator
command safely returns an unscheduled `APPROVED` project with no publishing
history to `AWAITING_APPROVAL`, allowing a fresh version-bound request and
decision after human review. It never rewrites the historical decision.
The approval CLI requires the supplied actor to have an appropriate organization
membership. Because a CLI actor ID is not an interactive authentication method,
the script must run only in a trusted operator environment.

This migration is additive and locally validated. It has not been applied to a
live database. Inspect unbound approval rows and existing publishing jobs in
staging before deployment; see `HUMAN_ACTIONS.md`.
