# Phase 11.2 — Instagram Login OAuth

Phase 11.2 replaces operator-imported placeholder credentials with a real server-side
Instagram Login authorization flow.

## Provider path

The implementation uses Instagram Login for professional accounts rather than the
Facebook Page-linked flow.

The requested scopes are deliberately minimal for the current publishing product:

- `instagram_business_basic`
- `instagram_business_content_publish`

No messaging or comment permissions are requested.

The Graph API version is pinned through `META_GRAPH_VERSION`; Phase 11.2 defaults to
`v26.0`.

## OAuth flow

Start authorization while signed in as an organization OWNER or ADMIN:

```text
GET /api/social/instagram/connect?clientId=<client-id>
```

The server:

1. verifies the client and organization role;
2. creates a 256-bit random OAuth state nonce;
3. stores only SHA-256 of the nonce in `SocialOAuthAttempt`;
4. binds the attempt to the current user and client;
5. expires the attempt after ten minutes;
6. redirects to Instagram authorization.

The callback is:

```text
GET /api/social/instagram/callback
```

The callback requires the same signed-in BrandSpace user, validates the one-time state,
atomically consumes it, exchanges the authorization code for a short-lived token,
exchanges that token for a long-lived token, verifies the Instagram profile with
`/me`, then encrypts the final token with the existing AES-256-GCM social-token key.

The Instagram Login API does not expose the Facebook Graph `/me/permissions` edge on
`graph.instagram.com`. The account therefore stores the exact scopes requested during
the OAuth authorization flow. Publishing capability is still enforced by Meta when the
publishing endpoints are exercised; later publishing phases must not treat the stored
scope list as a stronger provider-side permission guarantee.

Instagram Login can expose two account identifiers during connection. The
authorization-code exchange returns an authorization-side `user_id`, while `/me` can
return both `id` and the professional account `user_id`. When `id` is present, Forge
uses it to bind the OAuth exchange to the verified profile, while the professional
`user_id` remains the durable `SocialAccount.providerAccountId` used by publishing.

PKCE parameters are intentionally not invented: the current Instagram Login
authorization-code flow documents the server-side app-secret exchange. Durable,
single-use state protects the OAuth initiation/callback binding.

## Account promotion and rotation

A SocialAccount becomes `CONNECTED` only after:

- the Meta token exchanges succeed;
- `/me` identifies the professional account and username;
- the authorization flow was initiated with both required publishing scopes;
- the verified account belongs to the same client boundary.

Reconnecting the same Instagram account for the same client rotates the encrypted
credential and verification timestamps. A connected account cannot silently be
assigned to a different client.

## Required environment

```text
META_APP_ID=
META_APP_SECRET=
META_GRAPH_VERSION=v26.0
META_INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/social/instagram/callback
SOCIAL_TOKEN_ENCRYPTION_KEY=
```

The redirect URI must match the value configured in the Meta app exactly.

`apps/web/next.config.ts` loads the repository-root `.env` before the Next.js app starts
so the monorepo uses the same environment source as the worker/operator scripts.

## Acceptance

1. Run `npm install`.
2. Run `npm run db:generate`.
3. Apply the Phase 11.2 migration.
4. Typecheck and test `@forge/social`.
5. Typecheck/build `@forge/web`.
6. Configure the exact callback URI in Meta.
7. Sign in to BrandSpace and visit the connect endpoint for an ACTIVE client.
8. Complete Instagram authorization with an Instagram professional test account.
9. Confirm the callback returns `connected: true`.
10. Run `npm run instagram:account:list -- <client-id>` and confirm the real account is
    `CONNECTED`, has both publishing scopes and has non-null expiry/verification
    timestamps.
11. Run the full repository gates.

Phase 11.3 will refresh long-lived credentials before expiry and classify revoked or
invalid credentials as `NEEDS_REAUTH`.
