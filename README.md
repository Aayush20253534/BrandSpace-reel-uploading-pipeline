# BrandSpace Forge

Brand Space's production-oriented AI Content Operating System.

## Phase 1

This repository currently contains only the production foundation. Reel generation,
Drive ingestion, publishing and AI workflows are intentionally introduced phase by
phase.

## Requirements

- Node.js 22+
- npm 10+

No Docker dependency is required by Phase 1.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

On PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

Health check:

```bash
curl http://localhost:3000/api/health
```

Verification:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Repository

- `apps/web` — dashboard + application API
- `apps/worker` — background job runtime
- `packages/config` — validated environment configuration
- `packages/logger` — structured logging
- `packages/shared` — shared constants/types
- `packages/storage` — provider-neutral media storage boundary
- `docs` — architecture, security, ADRs and project state

## Infrastructure

Phase 1 does not force local PostgreSQL or Redis through Docker. When those services
become required, Forge will consume them through `DATABASE_URL` and `REDIS_URL`, so
development and production may use managed providers directly.

## Media decision

Google Drive is the canonical media store. Prefer a Brand Space Shared Drive. The
application database will store workflow state and Drive file identifiers, not raw
video bytes.
