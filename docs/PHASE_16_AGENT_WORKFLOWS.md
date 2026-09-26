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
- **Suggest a content plan:** Read `get_brand_profile`,
  `list_media_intelligence`, and available analytics for the same client.
  Return a proposal for human review. Do not claim a reel was created or
  scheduled from a read-only tool result.

## Pending write path

Creating, rendering, QA, approval decisions, scheduling and retrying need
separate mutation tools with narrow input schemas, live role and tenant checks,
idempotency keys and audit events. Until those tools exist, an agent can only
propose these actions. A real Instagram publish still requires the exact
version's approval and separate explicit operator authorization for the real
post. No prompt should bypass those gates.
