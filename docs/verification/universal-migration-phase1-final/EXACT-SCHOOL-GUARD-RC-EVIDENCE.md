# Exact-School Migration Guard — Release Candidate Evidence

**Prepared:** 2026-11-19  
**Base (live):** `702421787d75ff48a32f34bcdea4bec278cc32c1`  
**Branch:** `release/migration-exact-school-guard-on-7024217`  
**Worktree:** `/Users/tony-/Development/educlear-rc-migration-school-guard`  
**Status:** RC prepared — **NO deploy / NO production writes / flags remain unset**

---

## 1. Release-candidate SHA

See commit created on this branch (parent must be `7024217`).

---

## 2. Files changed (guard-only)

| File | Change |
|------|--------|
| `backend/src/services/migration/core/migrationProductionExecutionGuard.ts` | Require `CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID` exact match on production |
| `backend/src/services/migration/core/migrationProductionExecutionGuard.unit.test.ts` | Fail-closed matrix tests |
| `backend/src/services/migration/core/phase1bTenantIsolationHttp.unit.test.ts` | Confirm + school-id HTTP/guard cases |
| `backend/src/services/migration/core/postMigrationLedgerTransactions.ts` | Guard on ledger post |
| `backend/src/services/migration/parentFamily/applyParentFamilyMigrationPlan.ts` | Guard on parent/family apply |
| `backend/src/services/migration/academic/applyAcademicMigrationPlan.ts` | Guard on academic apply |
| `backend/src/services/migrationService.ts` | Guard on legacy import/rollback/classroom repair |
| `backend/src/services/migrationCentre/topupPaymentsImportService.ts` | Guard on top-up apply |
| `backend/src/services/migrationCentre/billingPlansImportService.ts` | Guard on billing-plans apply |
| `backend/src/services/migrationCentre/learnerGenderRepairService.ts` | Guard on learner-repair apply |
| `backend/src/services/migrationCentre/ageAnalysisBaselineRefreshService.ts` | Guard on age-baseline refresh |
| `backend/.env.example` | Document new env (commented) |
| `docs/verification/.../GUARD-RC-REGRESSION-OUTPUT.txt` | Test capture |
| `docs/verification/.../EXACT-SCHOOL-GUARD-RC-EVIDENCE.md` | This pack |

Already guarded (unchanged call sites, inherit new rules): `completeUniversalMigration`, `applyMigrationStage`.

Invoice-run / billing-calc / fee-exclusion paths: **0-byte** diff vs `7024217`.

---

## 3. Mutation-route coverage

| Mutation boundary | Enforcement |
|-------------------|-------------|
| `POST /api/migration/orchestrator/complete` → `completeUniversalMigration` | `requireMigrationWriteAllowed` |
| `POST /api/migration/apply` → `applyMigrationStage` | same |
| Parent/family apply | same (service entry) |
| Academic apply | same |
| Ledger / opening posting (`postSingleMigrationLedgerTransaction`) | same |
| Legacy `POST .../import` (`commitMigrationImport`) | same (still throws disabled after guard) |
| Legacy rollback / classroom repair | same |
| Migration Centre top-up / billing-plans / learner-repair apply | same |
| Age-analysis baseline refresh | same |

UI-only checks: **not** relied upon. Fail-closed: missing confirm, missing/empty/wildcard school id, or mismatched id → blocked.

`ALLOW_PROTECTED_SCHOOL_MIGRATION` remains required separately for Da Silva / Fly Eagle (keep **unset**).

---

## 4. Test results

| Suite | Result |
|-------|--------|
| `migrationProductionExecutionGuard.unit.test.ts` | **PASS** (10 cases) |
| `phase1bTenantIsolationHttp.unit.test.ts` | **PASS** (10/10) |
| `phase1SafeOnboarding.unit.test.ts` | **PASS** |
| `phase1bFailureRecovery.unit.test.ts` | **PASS** (11) |
| `phase1eMigrationImportPosting.unit.test.ts` | **PASS** |
| `invoiceFeeFrequencyExclusion.test.ts` | **OK** |
| `invoiceRunExecute.test.ts` | **OK** |
| Backend `tsc --noEmit` | **PASS** |
| Frontend `tsc --noEmit` | **PASS** |

Proven: missing confirm → BLOCKED; missing school id → BLOCKED; wrong school → BLOCKED; correct school + both controls → ALLOWED; protected schools → BLOCKED; wildcard config → BLOCKED.

---

## 5. Fail-closed confirmation

Production write requires **both**:

1. `CONFIRM_PRODUCTION_MIGRATION_WRITE=true`
2. `CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID=<exact-db-id>` matching `targetSchoolId`

No wildcards (`*`, `?`, comma lists). Empty/missing authorised id blocks.

---

## 6. Production backup verification (read-only)

Existing verified pack still present:

`backend/storage/pre-deploy-2026-11-18T16-40Z-universal-migration-rc/`  
Verdict: `BACKUP_VERIFIED_RECOVERABLE` (ledger sha `073e8d85…`, postgres `PGDMP`).

No production env flags enabled during this RC prep.

---

## 7. Rollback targets

| Side | Deploy | Commit |
|------|--------|--------|
| Backend | `dep-dbutjnkipgvc73csp890` | `7024217` |
| Frontend | `dep-dbutjnl6e07s73el5450` | `7024217` |

Auto-deploy must remain **OFF**. Deploy BE+FE together only after owner approval.

---

## 8. GO / NO-GO

### **GO** for owner-approved controlled deploy of this guard-only RC

Does **not** authorise enabling production migration flags or creating the disposable school. Those require a separate smoke approval after this RC is live.
