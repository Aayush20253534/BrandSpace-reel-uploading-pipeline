# Phase 2 Domain Model

## Identity

User -> Membership -> Organization

A user may belong to multiple organizations. A membership has one explicit role.

## Client tenancy

Organization -> Client -> BrandProfile

A Client cannot exist outside an Organization. Slugs are unique inside an
organization, not globally.

## Client configuration

Phase 2 persists stable client configuration:

- status and IANA timezone
- approval mode
- Google Drive root folder ID
- structured BrandProfile
- brand language and content rules
- CTA/caption/hashtag/subtitle policies
- logo Drive file reference
- music/reel/posting/compliance policies

Operational Reel/media/job tables remain Phase 3 work.

## Isolation invariant

A request must establish the authenticated user, organization membership and required
role before reading or mutating organization/client data. Never trust organizationId
or clientId merely because the browser supplied it.
