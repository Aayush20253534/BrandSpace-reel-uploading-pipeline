# Phase 11.1 — Multi-Client Social Account Foundation

Phase 11.1 introduces the tenant boundary for Instagram publishing. Phase 10 accepted a
free-form `socialAccountId`; Phase 11.1 replaces that placeholder with a real
`SocialAccount` relation owned by exactly one client.

## Data model

Each client can own multiple social accounts. `SocialAccount` stores:

- platform and provider account ID;
- username/display metadata;
- connection lifecycle status;
- granted scopes;
- encrypted access-token ciphertext;
- token expiry and verification timestamps;
- non-secret provider metadata.

`PublishingJob.socialAccountId` is now a foreign key to `SocialAccount`.

The migration preserves existing Phase 10 history by converting old free-form
publishing account labels into deterministic `DISCONNECTED` legacy rows. Historical
jobs remain queryable but cannot be used for new publishing.

## Credential security

Access tokens are encrypted with AES-256-GCM before PostgreSQL persistence. The master
key comes from `SOCIAL_TOKEN_ENCRYPTION_KEY` and must decode to exactly 32 bytes.

Generate a development key with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Store the resulting key in `.env`. Never commit it.

Ciphertexts use a versioned envelope and authenticated additional data so corrupted,
tampered or wrong-key decryptions fail closed.

## Instagram publishing scopes

The Phase 11 publishing account boundary records only the permissions required for the
planned Instagram Login publishing path:

- `instagram_business_basic`
- `instagram_business_content_publish`

Broader messaging/comment permissions are intentionally not requested.

## Safe operator import

Before OAuth is implemented, a real development token can be imported without putting
the token in shell history:

```powershell
$env:INSTAGRAM_ACCESS_TOKEN="<token>"
npm run instagram:account:import -- <client-id> <instagram-user-id> <username> [expires-at-iso]
Remove-Item Env:INSTAGRAM_ACCESS_TOKEN
```

Imported accounts remain `PENDING`. They are not schedulable until Phase 11.2 verifies
the token/profile with Meta and promotes the account to `CONNECTED`.

List a client's accounts without exposing ciphertext:

```powershell
npm run instagram:account:list -- <client-id>
```

## Scheduling isolation

New publishing jobs require a `SocialAccount` that:

- belongs to the same client as the ReelProject;
- uses the Instagram platform;
- is `CONNECTED`;
- has an encrypted credential;
- is not expired.

This makes cross-client posting fail before a `PublishingJob` is created.

## Acceptance

1. Add `SOCIAL_TOKEN_ENCRYPTION_KEY` locally.
2. Run `npm install` so the new workspace is reflected in the lockfile.
3. Run `npm run db:generate`.
4. Apply the checked-in migration with `npm run db:deploy`.
5. Typecheck/test `@forge/social`.
6. Run `npm run instagram:account:list -- <client-id>` and verify historical Phase 10
   account labels appear as `DISCONNECTED` legacy records.
7. Run the full repository verification suite.

Phase 11.2 adds the actual Instagram OAuth flow and Meta-side account/token
verification. No Instagram publishing API call occurs in Phase 11.1.
