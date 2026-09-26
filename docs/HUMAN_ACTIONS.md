# Human actions

## Blocking

### Provide access to the current Instagram Login publishing reference

Why: Meta's public developer documentation currently returns HTTP 429 or is
inaccessible from this workspace. Meta's public Postman Reels examples use the
Facebook Login flow, `graph.facebook.com` and Page tokens. Forge uses Instagram
Login and an Instagram user token, so copying those calls would risk an invalid
or unsafe production implementation.

Exact location: Meta for Developers → **Instagram Platform → Instagram API with
Instagram Login → Content Publishing**. In the app dashboard, confirm the
Instagram product's API setup and current version under **My Apps → BrandSpace
app → Instagram**.

Needed information: an accessible official URL or exported page showing the
Instagram Login base URL/version, Reel container create request, status request,
`media_publish` request, required permission, media limits, errors and rate
limits. Do not send access tokens or app secrets. This enables code and mock
tests for Phases 11.5–11.7 and 13; it does not authorize a live publish.

### Create a private temporary publication bucket and scoped credential

Why: Meta must fetch a generated reel over HTTPS while Google Drive remains the
canonical store. Forge's S3-compatible delivery needs a private bucket and an
object read/write credential; none is configured locally.

Exact dashboard: Cloudflare dashboard → **Storage & databases → R2 → Overview** →
**Create bucket**. Then **R2 → Overview → API Tokens → Manage → Create API token**.
For the fallback cleanup rule: **R2 → Overview → select the bucket → Settings →
Object Lifecycle Rules → Add rule**.

Exact field: Bucket name; token permission and bucket scope; S3 API endpoint;
Access Key ID; Secret Access Key. In the worker's private environment set
`PUBLICATION_S3_BUCKET`, `PUBLICATION_S3_REGION`, `PUBLICATION_S3_ENDPOINT`,
`PUBLICATION_S3_ACCESS_KEY_ID`, `PUBLICATION_S3_SECRET_ACCESS_KEY`.

Exact value/pattern: A dedicated private bucket such as
`brandspace-publication`; token permission **Object Read & Write**, scoped to that
bucket only; region `auto`; endpoint
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (use the jurisdiction-specific
endpoint if applicable). Keep public bucket access disabled. Set the lifecycle
rule prefix to `publication/` and the delete-after age to **3 days**.

How to verify: Run Phase 11.4 acceptance against a test reel; the signed GET URL
returns the MP4 without credentials, an unsigned GET is denied, and cleanup
removes the object. [Cloudflare's S3 setup steps](https://developers.cloudflare.com/r2/get-started/s3/)
show the current dashboard route and fields. [Lifecycle setup](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
shows the cleanup rule path.

What phase it blocks: Live acceptance of 11.4 and real Instagram publication in
11.5–11.7. It does not block code implementation or mock tests.

## Non-blocking production setup

### Deploy and review the version-bound approval migration

Why: Existing approval records may lack a reliable version link. The migration
backfills only rows with one matching request audit event; ambiguous rows remain
unbound and cannot authorize scheduling or dispatch.

Exact location: In the staging release environment with the staging
`DATABASE_URL`, run `npm run db:generate` and `npm run db:deploy`. Repeat in the
production release environment only after reviewing the staging result and
backing up production. The migration is
`20260926010000_version_bound_approvals`.

Exact check after migration: Run this read-only query in the database SQL console
for each environment:

```sql
SELECT a."id", a."reelProjectId", a."decision", p."state"
FROM "Approval" AS a
JOIN "ReelProject" AS p ON p."id" = a."reelProjectId"
WHERE a."reelVersionId" IS NULL
  AND a."decision" IN ('PENDING', 'APPROVED')
ORDER BY a."requestedAt" DESC;
```

Expected result: No active unbound approvals. For an unbound pending request,
use the signed-in operator's `user.id` from `/api/me` as `<actor-id>`, review
the current version and use `npm run reel:approval -- request
<reel-project-id> <actor-id>` to create a bound request, then decide that new
request. For an unbound approved project with **no publishing history**, run
`npm run reel:approval -- reopen <reel-project-id> <actor-id>`, review the reel,
then request and decide anew. If a project has publishing history, leave its
job disabled and investigate manually; the command refuses to reopen it.

What phase it blocks: Live acceptance of the approval hardening and safe future
publishing. No production migration has been run from this workspace.

### Approve the Meta permission and connect a test professional account

Why: Live end-to-end publication and later insights collection need an authorized
Instagram professional account. Real posting requires a separate explicit approval
for the exact reel and time.

Exact dashboard: Meta for Developers → **My Apps → BrandSpace app → App Review →
Permissions and Features**; then the Instagram professional account's connection
flow in BrandSpace.

Exact field: `instagram_business_basic` and
`instagram_business_content_publish` permissions, app access level and account
authorization.

Exact value/pattern: Advanced access for customer accounts as required by the
Meta app's current review UI; authorize a dedicated test professional account
for acceptance. Do not use a Facebook Page token for this Instagram Login flow.

How to verify: The account appears as `CONNECTED` in
`npm run instagram:account:list -- <client-id>` with the durable professional
Instagram user ID. A real publish remains separately approval gated.

What phase it blocks: Live acceptance of 11.5–11.7 and 13.
