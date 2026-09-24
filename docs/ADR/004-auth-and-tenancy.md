# ADR-004: Authentication and tenant isolation

Status: Accepted

## Decision

Use Better Auth for application authentication and Prisma/PostgreSQL for durable
identity data. Brand Space is represented as an Organization. Users access an
organization through Membership records with explicit roles.

Every client belongs to exactly one Organization. Client-scoped resources introduced
in later phases must carry both organization/client ownership through their parent
relations and must be authorized server-side.

## Roles

OWNER, ADMIN, CONTENT_MANAGER, EDITOR, REVIEWER, ANALYST and VIEWER.

Role checks are authorization controls, not UI decoration. Hiding a button never
replaces a server-side check.

## Session policy

Email/password authentication is enabled initially. Sessions expire after seven days
and refresh at most daily. OAuth can be added later without replacing the domain model.
