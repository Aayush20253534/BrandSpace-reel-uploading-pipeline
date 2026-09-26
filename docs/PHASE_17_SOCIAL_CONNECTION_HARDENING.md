# Instagram connection hardening

The OAuth callback validates the signed-in user, client membership and state
before using an authorization code. A missing code, missing configuration or
provider error leaves the state unconsumed. After a successful Instagram Login
exchange, the callback encrypts the verified result and stores it on the OAuth
attempt. It then updates the social account, creates an audit event and consumes
the state in one serializable database transaction. A failed account transaction
can resume from the encrypted result while the original state remains valid;
the result is cleared when the transaction commits.

The migration adds a partial unique index on active (`CONNECTED` or
`NEEDS_REAUTH`) platform/account pairs. Disconnected and disabled historical
rows can coexist so a deliberate transfer is possible. The callback also checks
for ownership before upsert to return a clear error, while the index resolves
concurrent connections at the database boundary. A duplicate preflight causes
the migration to fail without choosing an owner. The partial index is SQL-only
because Prisma 6.19.3 does not model it in `schema.prisma`.

The provider's free-form error description and raw exception are not returned
or logged by the callback. Logs contain only an error class and Prisma code.
Stored OAuth results use the same AES-256-GCM key as social tokens and expire
with their ten-minute state; the connect endpoint prunes expired attempts for
the user. A process failure after provider exchange but before the encrypted
result is saved still requires a fresh authorization, because Meta authorization
codes are one-time. This is reported as a connection failure, not a completed
connection. No live Meta flow or database migration has run in this workspace.
