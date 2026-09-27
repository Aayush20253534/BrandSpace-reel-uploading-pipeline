# Safe agent workflows

Agents access Forge through the scoped MCP endpoint. They do not receive a
database connection, Drive credential, Meta token or local filesystem path.
The bearer credential belongs to a named user, inherits that user's current
organization role, and may be restricted to one client. Operators revoke it
when access is no longer needed.

## Available now

- **Show reels awaiting approval:** Call `list_clients`, then
  `list_reel_projects` and `list_approvals` for the chosen client. Match
  `reelProjectId` and `reelVersionId`; describe the decision as recorded. A
  missing or unbound approval is not an approval.
- **Why did a publishing job fail?** Call `list_publishing_jobs` and report the
  state, attempt count and stable `lastErrorCode`. An owner, admin or content
  manager can use `list_audit_events` to inspect the action sequence. Provider
  error text and credentials are deliberately hidden.
- **Compare recent reel performance:** Call `list_analytics_snapshots` for the
  same client and compare captured metrics by job and timestamp. Say when no
  snapshots exist; the Instagram insights collector is not live yet.
- **Inspect creative history:** Call `list_feedback_observations` for the same
  client to see versioned features and exact reel, job and snapshot references.
  Its creative usage counts do not establish performance or causality. Use
  `list_analytics_snapshots` to inspect provider-returned metrics separately.
- **Suggest a content plan:** Read `get_brand_profile`,
  `list_media_intelligence`, `list_feedback_observations`, and available
  analytics for the same client.
  Return a proposal for human review. Do not claim a reel was created or
  scheduled from a read-only tool result.

## Pending write path

With a client-specific write credential, an authorized editor can call
`create_reel_project` once per UUID idempotency key to create a draft. The
agent should report the resulting project ID and `DRAFT` state. Planning,
rendering, QA, approval decisions, scheduling and retrying still need separate
mutation tools with narrow schemas and audit events. Until those tools exist,
an agent can only propose those actions. A real Instagram publish still
requires the exact version's approval and separate explicit operator
authorization for the real post. No prompt should bypass those gates.

After an active reel version passes both technical and creative QA, an editor
with a client-scoped write credential can call `request_reel_approval` with a
fresh UUID idempotency key. This records a pending human review for that exact
version. It cannot approve or publish. For a client using automatic content
approval, the request reopens an unscheduled approved project for human review;
the Instagram worker still requires an explicit approved decision.
