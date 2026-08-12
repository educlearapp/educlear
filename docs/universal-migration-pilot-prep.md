# Universal Migration — Controlled Pilot Preparation Pack

## Status rule

**DEPLOYMENT DOES NOT AUTHORIZE MIGRATION.**

Even after the RC is deployed and smoke-tested, Pilot #1 requires a separate explicit approval.

---

## 1. Release candidate

- Branch: `release/universal-migration-pilot-rc`
- Worktree: `/private/tmp/educlear-mbb-ui-migration-rc`
- Base: `origin/main` / `5e8547b329111bea5146cedda4ca3f9ca1d84837`
- Contents: approved Phase 1B–1N Universal Migration runtime + tests + Prisma school-scoped Parent unique migration
- Excluded: ephemeral `backend/storage` migration artifacts, uploads, local data dumps

## 2. Schema note (non-negotiable)

- `Parent.idNumber` global `@unique` → `@@unique([schoolId, idNumber])`
- Migration folder: `backend/prisma/migrations/20260811120000_parent_idnumber_school_scoped_unique/`
- **Use `prisma migrate deploy` in production if not already applied.**
- **Never `prisma db push`.**
- If this migration is not yet on production DB, pilot is blocked until migrate deploy is separately authorized.

## 3. Persistent disk / locks

Render mounts persistent disk at:

`/opt/render/project/src/backend/data`

Phase 1N completion locks use:

`data/migration-orchestrator/locks/`

Billing ledger lock already uses `data/`.

**Requirement:** all backend instances that can run Complete Migration must share this disk. Current blueprint shows one web service + one disk.

## 4. Backup plan (execute only immediately before pilot)

1. Take verified production DB backup; record id + timestamp.
2. Confirm backup restoreability with ops policy.
3. Capture target-school pre-migration snapshot (counts + finance cents).
4. Retain school export package + fingerprint.
5. Confirm billing ledger / age-analysis files on persistent disk are intact.

Do **not** treat full DB restore as a casual default — it can affect other schools that changed after the backup.

## 5. Actual-export disposable rehearsal (mandatory before real write)

```
REAL SCHOOL EXPORTS
→ disposable/test EduClear school
→ Upload → Auto analyse → Review → Complete
→ Verify R0.00 / statements / Fee Check / Accept (if finance)
```

Only after that passes, consider the same source shape for the real target school.

## 6. Future deployment sequence (DO NOT RUN IN PHASE 1O)

1. Confirm RC SHA/tree
2. Confirm production backup
3. Confirm persistent disk
4. Confirm env (no secrets in tickets)
5. Deploy backend
6. Verify backend health
7. Deploy frontend
8. Verify Migration Center
9. **Stop — do not migrate**
10. Read-only/safe smoke
11. Disposable rehearsal with real exports
12. Explicit authorization for real pilot
13. Only then Pilot #1

## 7. Pilot school selection criteria

Prefer a cooperative, manageable school with recognizable exports, finance export if testing full path, verification availability, and non-catastrophic rollback impact.  
**Do not use Da Silva Academy as the default first pilot.**

## 8. Finance cutover

Record finance export timestamp and source total. If source changes materially after export, obtain a new export and reanalyse. Do not Accept against a stale export.

## 9. Success / failure

Success requires correct school, correct counts, R0.00 finance (when supplied), statement + Fee Check MATCH, COMPLETE_ACCEPTED, no duplicates, no cross-school impact, usable school afterward.

Fail/stop on wrong-school write, finance ≠ R0.00, false Accept, unsafe merges, duplicates, cross-school leakage, unrecoverable state.
