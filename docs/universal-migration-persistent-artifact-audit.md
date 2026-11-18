# Universal Migration — Persistent Artifact Audit (Phase 1O → Phase 1B)

Render backend: `process.cwd()` = `backend/`. Persistent disk mounts at `backend/data` only.

## Persistent (`data/`) — Phase 1B write root

| Artifact | Path | Survives deploy/restart? |
|----------|------|---------------------------|
| Completion locks | `data/migration-orchestrator/locks/` | YES (shared disk) |
| Orchestrator runs / readiness | `data/migration-orchestrator/` | YES (new writes) |
| Sessions, stages, manifests, plans, finance/accept evidence, batches, reports, templates, registry, signoffs, pilots, runbooks, readiness | `data/migration-*` | YES (new writes) |
| Staging uploads (universal) | `data/migration-staging/` | YES (preferred write) |
| Billing ledger / age analysis (existing) | `data/` | YES |

## Legacy (`storage/` / `uploads/`) — read-compatible, never blindly moved/deleted

| Artifact | Path | Survives deploy/restart? |
|----------|------|---------------------------|
| Pre-Phase-1 control-plane JSON | `storage/migration-*` | NO on ephemeral disk, but **still readable** via dual-read |
| Uploaded source files (legacy) | `uploads/migration-staging/`, `storage/migration-staging/` | Allowed read roots retained |

## Dual-read policy (Phase 1B)

- **WRITE:** always `data/migration-<key>/`
- **READ:** `data/` first, then legacy `storage/migration-<key>/`
- **Never** bulk-move or silently delete legacy migration records

## Classification

- **Completion lock production compatibility:** YES for current single-web-service topology sharing `data/` disk.
- **Retry/reopen after backend restart:** Supported for artifacts written under `data/` after Phase 1B. Legacy `storage/` artifacts remain readable without migration.

## Database

Authoritative EduClear school data lives in DB / `data/` ledger — survives. Migration control-plane evidence now writes to persistent `data/` with legacy fallback reads.
