# Security Baseline

1. Never commit `.env`, OAuth tokens, service-account private keys or Meta credentials.
2. Production secrets must come from the deployment platform's secret manager.
3. Google Drive access must use the least privilege compatible with the media workflow.
4. Prefer an organization-owned Shared Drive over personal My Drive storage.
5. Never expose Drive credentials or raw private Drive URLs to the browser.
6. Validate all file metadata and media contents before processing.
7. Temporary worker files must use isolated directories and be deleted after jobs.
8. Every client-scoped operation will require server-side authorization.
9. AI providers never receive Google/Meta credentials.
10. Publishing will use explicit idempotency and durable database state.

## Deployment probes

`GET /api/health` checks that the web process responds. `GET /api/ready` runs a
minimal PostgreSQL query and returns HTTP 503 while the database is unavailable.
Use `/api/ready` for deployment readiness and `/api/health` for liveness. Both
responses are uncached and contain no credentials or database error text.
