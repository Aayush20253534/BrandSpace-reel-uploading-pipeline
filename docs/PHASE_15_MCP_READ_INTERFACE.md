# MCP read interface

`POST /api/mcp` serves the official MCP TypeScript SDK v2 Streamable HTTP
protocol. It uses a fresh MCP server per request and a module-level handler so
response streams remain alive. The route accepts a bearer credential only;
browser session cookies do not authorize it. The route checks the configured
`APP_URL` host and any `Origin` header, rejects large declared request bodies,
and returns `Cache-Control: no-store`.

An `AgentAccessToken` stores only the SHA-256 hash of a 256-bit random token.
It is bound to one user and organization, can be limited to one client, expires
after 30 days and can be revoked. Each request checks expiry, revocation, the
user's current organization membership, and optional client ownership. An
atomic database update limits each credential to 60 requests per minute across
web instances. The operator command audits creation and revocation.

Available read tools: `list_clients`, `get_brand_profile`,
`list_media_assets`, `list_media_intelligence`, `list_reel_projects`,
`get_reel_version`, `list_approvals`, `list_publishing_jobs`,
`list_social_account_health`, `list_analytics_snapshots`, and
`list_audit_events`. Role-specific tool registration follows the dashboard's
read boundaries, with account health and audit limited to owners, admins and
content managers. Every client-scoped call verifies the client is in the
credential's organization and optional client restriction. List tools use
bounded pagination. Responses use explicit field selections and never expose
social token ciphertext, raw tokens, arbitrary filesystem paths, SQL, or
free-form audit/provider error metadata.

Create a credential from a trusted operator environment after applying the
`20260926030000_agent_access_tokens` migration:

```text
npm run agent:token -- create <organization-id> <admin-user-id> <target-user-id> <client-id|all> <label>
npm run agent:token -- revoke <credential-id> <admin-user-id>
```

The creation command prints the bearer token once. Store it in the MCP client's
secret manager, send it only over HTTPS, and do not put it in prompts, logs, or
the repository. The CLI actor ID is trusted only because the command must run
in a privileged operator environment; it is not interactive authentication.

Read credentials remain read only. A separate short-lived, client-specific
write scope can expose the draft-only `create_reel_project` tool described in
`PHASE_15_MCP_DRAFT_CREATION.md`. Further mutation tools, user-facing OAuth
authorization for ChatGPT, and live deployment acceptance are still pending.
The SDK's current [HTTP serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http)
describes the handler and transport used here.
