# Human actions

## Blocking

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
