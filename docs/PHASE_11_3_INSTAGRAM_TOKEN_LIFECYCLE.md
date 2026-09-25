# Phase 11.3 — Instagram Token Lifecycle

Phase 11.3 keeps tenant-scoped Instagram Login credentials usable after the initial
OAuth connection without storing or logging plaintext tokens.

## Provider behavior

Forge uses the Instagram Login long-lived-token refresh endpoint:

```text
GET https://graph.instagram.com/refresh_access_token
  ?grant_type=ig_refresh_token
  &access_token=<long-lived-token>
```

Long-lived tokens are refreshed only while they are still valid and only after they
are old enough for Meta to accept a refresh. Forge uses a conservative 14-day
pre-expiry window and enforces a 24-hour minimum token age.

The refreshed token is verified against `/me` before it replaces the existing
encrypted credential.

## Durable lifecycle state

`SocialAccount` records:

- `tokenIssuedAt`
- `lastRefreshAttemptAt`
- `lastRefreshedAt`
- `tokenRefreshLockedAt`
- `lastAuthErrorCode`
- `lastAuthErrorMessage`

The refresh lock is a database lease. It prevents two worker processes from rotating
the same credential concurrently and can be reclaimed after 30 minutes if a worker
dies mid-refresh.

## Worker policy

The worker runs token maintenance at startup and every six hours.

For `CONNECTED` Instagram accounts:

1. already-expired credentials move directly to `NEEDS_REAUTH`;
2. credentials expiring within 14 days become refresh candidates;
3. tokens younger than 24 hours are not refreshed;
4. a worker atomically claims the account with `tokenRefreshLockedAt`;
5. the token is decrypted only in memory;
6. Meta refreshes the long-lived token;
7. Forge verifies that the refreshed credential still resolves to the same durable
   professional `providerAccountId`;
8. the new token is encrypted with a fresh AES-GCM IV before the database update;
9. expiry, verification and refresh timestamps are updated atomically;
10. successful rotations and reauthentication transitions create audit events.

No access token is written to logs, audit metadata, API output or error fields.

## Error classification

Provider responses that indicate an invalid/revoked credential or lost authorization
move the account to `NEEDS_REAUTH`. HTTP 401 and Meta authorization/permission codes
used by this flow are treated as reauthentication failures.

Rate limits and provider 5xx responses do not disconnect the account. The lease is
released, the sanitized failure is stored for operators, and the next maintenance run
can retry.

A refreshed token that resolves to a different professional account is treated as a
reauthentication condition rather than silently changing tenant ownership.

## Acceptance

1. Run `npm install` so the worker workspace receives `@forge/social`.
2. Run `npm run db:generate`.
3. Apply migration `20260925200000_phase11_3_instagram_token_lifecycle`.
4. Typecheck/test `@forge/social`.
5. Typecheck/build `@forge/worker`.
6. Run `npm run instagram:account:list -- <client-id>` and confirm existing connected
   accounts have a backfilled `tokenIssuedAt`.
7. Start the worker and confirm an account with roughly 60 days remaining is not
   refreshed early.
8. Run the full repository typecheck, lint, test, build and formatting gates.

The first live provider refresh should be observed after the connected token is at
least 24 hours old and enters the configured refresh window. Phase 11.3 deliberately
does not force an early refresh merely to satisfy acceptance testing.
