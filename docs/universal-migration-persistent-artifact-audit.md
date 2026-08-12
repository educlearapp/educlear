# Universal Migration — Persistent Artifact Audit (Phase 1O)

Render backend: `process.cwd()` = `backend/`. Persistent disk mounts at `backend/data` only.

## Persistent (`data/`)

| Artifact | Path | Survives deploy/restart? |
|----------|------|---------------------------|
| Completion locks | `data/migration-orchestrator/locks/` | YES (shared disk) |
| Billing ledger / age analysis (existing) | `data/` | YES |

## Ephemeral (`storage/` or `uploads/`) — RESTRICTION / BLOCKER RISK

| Artifact | Path | Survives deploy/restart? |
|----------|------|---------------------------|
| Orchestrator runs | `storage/migration-orchestrator/` | NO |
| Source manifests | `storage/migration-source-manifests/` | NO |
| Stages | `storage/migration-stages/` | NO |
| Sessions | `storage/migration-sessions/` | NO |
| Parent/family plans | `storage/migration-parent-family/` | NO |
| Academic plans | `storage/migration-academic/` | NO |
| Finance reconciliations | `storage/migration-finance-reconciliations/` | NO |
| Statement authority | `storage/migration-statement-authority/` (+ baselines) | NO |
| Fee Check authority | `storage/migration-feecheck-authority/` | NO |
| Acceptances | `storage/migration-acceptances/` | NO |
| Compiled plans / source analyses | `storage/migration-compiled-plans/`, `migration-source-analyses/` | NO |
| Uploaded source files | `uploads/migration-staging/` | NO |

## Classification

- **Completion lock production compatibility:** YES for current single-web-service topology sharing `data/` disk.
- **Retry/reopen after backend restart mid-pilot:** CRITICAL artifacts under `storage/` are **ephemeral** → **PILOT RESTRICTION** (and potential release blocker if multi-day / restart expected).

### Operational mitigation for controlled Pilot #1

1. Complete Upload → Analyse → Review → Complete → evidence export in **one continuous window**.
2. **Do not deploy or restart** backend between upload and audit package export.
3. Immediately copy/export the pilot audit package off the instance after Complete.
4. Treat post-restart reopen of the same stage as **unsupported** until artifacts are moved to `data/` in a future hardening phase.

## Database

Authoritative EduClear school data (learners, parents, links, classrooms, subjects, family accounts, ledger via billing store) lives in DB / `data/` ledger — survives. Migration *control-plane* evidence currently does not (except locks).
