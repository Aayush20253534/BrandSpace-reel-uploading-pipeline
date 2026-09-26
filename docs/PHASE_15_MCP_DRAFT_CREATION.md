# MCP draft project creation

`create_reel_project` is the first MCP mutation. It creates a `DRAFT` project
only. The tool is advertised only to an owner, admin, content manager or editor
using a client-specific credential with the `write` scope. The mutation
rechecks the credential, current organization membership, client ownership and
active client status inside its serializable transaction.

The input schema requires the exact client ID, a title of at most 120
characters, an optional objective of at most 1,000 characters and a UUID
idempotency key. Replaying the same key and content returns the original
project. Reusing a key with different content fails. The project, audit event
and idempotency result commit atomically; a concurrent loser rolls back its
draft and reads the winner's result. The audit event attributes the action to
the credential's user and records the MCP credential ID without the bearer
secret.

An owner or admin can issue a seven-day client-specific write credential from
a trusted operator shell:

```text
npm run agent:token -- create <organization-id> <admin-user-id> <target-user-id> <client-id> <label> write
```

The default omitted scope remains read only and expires after 30 days. Use
`npm run agent:token -- revoke <credential-id> <admin-user-id>` to revoke. Apply
`20260926050000_agent_mutation_idempotency` before enabling write credentials.
No live credential was issued or project created in this workspace.

Planning, rendering, QA, approval decisions, scheduling and retry tools are
still pending. This tool does not trigger AI, queues or a real Instagram post.
