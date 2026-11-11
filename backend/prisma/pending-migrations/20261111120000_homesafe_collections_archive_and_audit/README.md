# PENDING — HomeSafe Collections soft-delete + mutation audit

**Status:** Prepared only. **Do not run** `prisma migrate deploy` / `migrate dev` for this folder until owner-approved.

## Why

Live `HomeSafeCollection*` models have no `archivedAt` / soft-delete and no actor audit columns.
Hard delete is blocked server-side whenever register history exists, so historical rows are never silently lost.

True archive UX and actor/timestamp audit for management + register mutations require this additive schema.

## Proposed additive changes

See `migration.sql`.

## Rollback

Drop the new nullable columns / indexes only (no data rewrite). Do not drop Collections tables.
