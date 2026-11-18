# Universal Migration — Controlled Deployment Preparation

**Date:** 2026-11-18  
**Branch examined:** `feature/universal-migration-phase1-safe-onboarding` (`e4e5058`)  
**Action taken:** Preparation / verification only  
**Deploy / merge / production writes:** **NOT performed**

---

## Explicit recommendation: **NO-GO**

Do **not** deploy or merge this branch onto production as it stands.

Critical blocker: the branch **does not contain** the current live production SHA and would **regress Fly Eagle invoice-run preview-lock** (and other live billing fixes) if deployed.

---

## 1. Production baseline (verified read-only)

| Service | ID | Live deploy | Live commit | Auto-deploy |
|---------|-----|-------------|-------------|-------------|
| Backend | `srv-d6j8jvma2pns7397bghg` | `dep-dbupfllckfvc73ctc0eg` | **`6da6b7413cb76494428ada29a06c86a3668f1382`** | **`no`** |
| Frontend | `srv-d6j8svruibrs73age3d0` | `dep-dbupfltg1s2s73ci9a7g` | **`6da6b7413cb76494428ada29a06c86a3668f1382`** | **`no`** |

Live message: `test(billing): regress Fly Eagle Dec preview-to-execute omission`  
Evidence: `backend/storage/pre-deploy-2026-11-18T16-06Z-universal-migration/LIVE-BASELINE.json`

### Branch vs live

| Check | Result |
|-------|--------|
| Is live `6da6b74` an ancestor of feature HEAD? | **NO** |
| Fly Eagle `reviewedPreview` / preview-lock on live | **Present** |
| Fly Eagle preview-lock on feature HEAD | **Absent** |
| Invoice-run diff vs live | **Large divergent rewrite** (would drop live protections) |
| Dirty working tree | **Large** — migration + many unrelated untracked/local files |

**Required before any RC:** rebase or cherry-pick **approved migration-only commits** onto **`6da6b74`** (or a release branch cut from live), then re-run acceptance. Do not ship the current divergent invoice-run lineage.

---

## 2. Backups and rollback

### Ledger / disk

| Item | Status |
|------|--------|
| Persistent disk | `dsk-d8i06c0jo6nc73coaglg` → `/opt/render/project/src/backend/data` (10GB) |
| SSH spot-check (this prep) | **PASS** — live HEAD `6da6b74`, Da Silva `kidesys_topup` **346**, ledger bytes **25,922,570**, sha256 `073e8d857dc3a5973f892799682ba460d799afff65b7bf2515bc22788268e6c1` |
| Full local ledger pull (this prep) | **FAIL** — SSH dropped before base64 transfer |
| Same-day prior verified backup | `pre-deploy-2026-11-18T12-15Z-fly-eagle-dec-preview-lock` — **BACKUP_VERIFIED_RECOVERABLE** at that time (sha `60b5d1df…`); **ledger SHA has changed since** |

**Blocker for deploy day:** obtain a fresh full recoverable local + on-instance ledger copy **after** RC is ready and **immediately before** deploy. Spot-check alone is not enough once ledger SHA drifts.

### Rollback targets (current live = safe rollback)

If a future migration deploy fails, redeploy **both** services to:

| | Deploy ID | Commit |
|--|-----------|--------|
| Backend | `dep-dbupfllckfvc73ctc0eg` | `6da6b7413cb76494428ada29a06c86a3668f1382` |
| Frontend | `dep-dbupfltg1s2s73ci9a7g` | `6da6b7413cb76494428ada29a06c86a3668f1382` |

Commands recorded in:  
`backend/storage/pre-deploy-2026-11-18T16-06Z-universal-migration/ROLLBACK-TARGETS.json`

---

## 3. Release candidate readiness

### Not ready as a deployable SHA

- Feature HEAD `e4e5058` is **not** a valid RC against live.
- Working tree contains uncommitted migration work **plus** unrelated local artifacts (comms, HomeSafe, device-test, storage dumps, etc.).
- Prisma migration folders present under untracked (`school_is_demo_tenant`, reminder campaigns) — must be explicitly reviewed before any production `migrate deploy`.

### Migration-scoped tests run this prep (local)

| Test | Result |
|------|--------|
| `migrationProductionExecutionGuard.unit.test.ts` | **PASS** |
| `phase1bTenantIsolationHttp.unit.test.ts` | **8/8 PASS** (Da Silva + Fly Eagle protected) |
| `phase1eMigrationImportPosting.unit.test.ts` | **PASS** |
| `phase1ePreApplyFinanceStatus.unit.test.ts` | **PASS** |
| `accountabilityAdapter.unit.test.ts` | **PASS** — detect/parse/map/stage refuse without samples |
| Backend `tsc --noEmit` | **PASS** |
| Frontend `tsc --noEmit` | **PASS** |
| Phase 1 final acceptance harness (earlier today) | **PASS** (R0.00) on disposable school |

### AccountAbility

Adapter status **`planned`**: `detect()` always false; staging throws. Inactive until real exports exist.

### Auto-deploy

Confirmed **`no`** on both production services.

### Environment (must remain)

| Variable | Required setting for normal ops |
|----------|----------------------------------|
| `ALLOW_PROTECTED_SCHOOL_MIGRATION` | **unset** / not `true` |
| `CONFIRM_PRODUCTION_MIGRATION_WRITE` | **unset** / not `true` |
| `CONFIRM_PRODUCTION_WRITE` | only when an explicit production write is approved |
| Persistent disk mount | `/opt/render/project/src/backend/data` |

---

## 4. Final checklist return

| Item | Value |
|------|--------|
| Live backend SHA / deploy | `6da6b74…` / `dep-dbupfllckfvc73ctc0eg` |
| Live frontend SHA / deploy | `6da6b74…` / `dep-dbupfltg1s2s73ci9a7g` |
| Release candidate SHA | **None — blocked** (must cut from live + migration-only) |
| Build / tests | Migration guards + tsc **PASS**; RC build against live base **not done** |
| Backup | Spot-check **PASS**; full local copy **FAIL** (retry before deploy) |
| Rollback targets | Live `6da6b74` pair (above) |
| Env | Auto-deploy off; protected-school confirms unset |
| Risks / blockers | (1) Branch missing live Fly Eagle invoice fixes (2) Dirty/unrelated tree (3) Full ledger backup incomplete (4) Possible schema migrations need explicit review |

### GO / NO-GO

# **NO-GO for deployment**

**GO path (next steps, still no deploy until owner approval):**

1. Create `release/universal-migration-…` from **`6da6b7413cb76494428ada29a06c86a3668f1382`**.
2. Cherry-pick / port **only** approved Universal Migration Centre changes (Phase 1E payment pathway, projected finance UI, guards, dual-root artifacts, picker).
3. Re-run migration acceptance + invoice-run regression (Fly Eagle preview-lock + Da Silva Dec exclusions) on that RC.
4. Fresh full ledger + migration-artifact backup; confirm sha256 match.
5. Owner-approved paired BE+FE deploy with rollback to `6da6b74`.

**Stopped before deployment. No merge, deploy, production migration, or school data modification performed.**
