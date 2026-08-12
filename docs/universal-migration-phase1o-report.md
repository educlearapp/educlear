# Phase 1O — Controlled Pilot Preparation & Deployment Readiness Report

**Date:** 2026-08-12  
**STOP:** No deploy. No push. No merge to main. No real-school migration.

---

## A. Verdict

**READY FOR PILOT WITH RESTRICTIONS**

---

## B. Worktree isolation proof

| Item | Result |
|------|--------|
| Phase 1O worktree | `/private/tmp/educlear-mbb-ui-phase1o` |
| Branch | `release/migration-controlled-pilot-prep` |
| Overlay from 1N | `OVERLAY_1N_TO_1O_BYTE_PASS` (pre/post fingerprints identical at overlay) |
| Prior trees | `PRIOR_TREES_STILL_UNCHANGED_PASS` (reverified after RC work) |

---

## C. Starting SHA / branch / final local SHA

| Tree | Branch | HEAD |
|------|--------|------|
| Phase 1O | `release/migration-controlled-pilot-prep` | `5e8547b329111bea5146cedda4ca3f9ca1d84837` (uncommitted overlay + 1O docs) |
| RC | `release/universal-migration-pilot-rc` | `b849515d0a8bdb6e6ac20e628aa8e29e5fa8f905` |
| RC tree | | `9dd00de1eb9f14dfe91bef11f37959bfc6ce199c` |
| Base / origin/main | | `5e8547b329111bea5146cedda4ca3f9ca1d84837` |

---

## D. Approved Phase 1B–1N change inventory

See `docs/universal-migration-phase1o-change-inventory.md` and `/tmp/phase1o-rc-manifest.txt` (82 approved paths + Phase 1O docs/script).

Classifications used: APPROVED_MIGRATION_RUNTIME / TEST / DOCUMENTATION / SCHEMA_REQUIRED.  
No UNCERTAIN files entered the RC. Storage artifacts excluded.

---

## E. Release candidate assembly

| Field | Value |
|-------|-------|
| Base SHA | `5e8547b329111bea5146cedda4ca3f9ca1d84837` |
| RC branch | `release/universal-migration-pilot-rc` |
| RC worktree | `/private/tmp/educlear-mbb-ui-migration-rc` |
| RC SHA | `b849515d0a8bdb6e6ac20e628aa8e29e5fa8f905` |
| Tree SHA | `9dd00de1eb9f14dfe91bef11f37959bfc6ce199c` |
| Commits | `73f4762` assemble RC; `b849515` simulateFailAt HTTP gate |
| Diff stats | 161 files, +26574 / −558 (first commit) + 1 file gate fix |
| Push / merge / deploy | **NONE** |

---

## F. Unrelated-change exclusion proof

RC contains Universal Migration / parent-identity / Fee Check / finance authority / Migration Center only.  
Payroll/EduClock/HomeSafe/ScriptCheck hits are pre-existing schema relations or category-detection keywords (to **exclude** payroll), not new payroll features. Temporary MBB tools not included.

---

## G. Schema / migration audit

| Question | Answer |
|----------|--------|
| `schema.prisma` changed? | **YES** — `Parent.idNumber` global `@unique` → `@@unique([schoolId, idNumber])` |
| migrations directory changed? | **YES** — `20260811120000_parent_idnumber_school_scoped_unique/` |
| New DB migration required? | **YES** — via `prisma migrate deploy` if not already on target |
| `db push` required? | **MUST BE NO** |
| Destructive schema? | **NO** (index swap only; rows untouched) |

Local disposable DB already has school-scoped unique index; `_prisma_migrations` history may still need resolve/deploy alignment on each environment.

---

## H. Production topology audit (read-only)

From `render.yaml`:

- Backend: single web service `educlear-backend`, `rootDir: backend`
- Frontend: static `educlear-frontend`
- Persistent disk: `educlear-billing-data` → mount `/opt/render/project/src/backend/data` (1GB)
- Expected instances: **one** web backend in blueprint (not a multi-instance farm)

---

## I. Persistent disk verification

- `process.cwd()` intended = `backend/` so `data/` resolves to mounted disk
- Billing ledger already depends on this mount
- Completion locks: `data/migration-orchestrator/locks/`

---

## J. Completion lock production compatibility

**WILL THE LOCK WORK ACROSS THE ACTUAL PRODUCTION TOPOLOGY?**

**YES** — for the documented single-web-service + shared `data/` disk topology.

If production is ever scaled to multiple backend instances **without** a shared `data/` mount, answer becomes **NO** → pilot not ready until shared storage or distributed lock is fixed.

---

## K. Persistent migration artifact audit

See `docs/universal-migration-persistent-artifact-audit.md`.

- **Persistent:** completion locks (+ billing `data/`)
- **Ephemeral:** orchestrator runs, stages, sessions, plans, reconciliations, statement/fee/accept evidence, uploads under `storage/` / `uploads/`

**Restriction:** Pilot must complete Upload→Complete→audit export in one continuous window without backend deploy/restart.

---

## L. Environment / config readiness

| Name | Required? | Purpose |
|------|-----------|---------|
| `DATABASE_URL` | Required | DB (value not printed) |
| Super Admin allowlist / JWT secrets | Required | Migration access (`requireMigrationAccess`) |
| `ALLOW_DISPOSABLE_MIGRATION_E2E` | Must be **unset/false** in prod | Harness / simulateFailAt only |
| `CONFIRM_PRODUCTION_WRITE` | N/A for migration APIs | Existing deploy rule |
| Persistent `data/` mount | Required | Locks + billing |

No secret values printed.

---

## M. Production write-safety review

- Migration APIs behind `requireMigrationAccess` (platform Super Admin only)
- `targetSchoolId` required on prepare/complete/readiness
- School mismatch → `MIGRATION_SCHOOL_MISMATCH` (phase1c + domain gates)
- No global truncate / migration-wide delete / startup schema mutation / `db push`
- Writes are school-scoped through stage binding + Prisma `schoolId` filters

---

## N. Backup plan

Documented in `docs/universal-migration-pilot-ops.md`. Execute only immediately before authorized Pilot #1: DB backup id+timestamp+verify; school snapshot; export package; confirm `data/` disk.

---

## O. Pre-migration snapshot procedure

`backend/src/scripts/migrationPilotSchoolSnapshot.ts` — counts + ledger cents. Guarded; refuses Da Silva unless explicit allow.

---

## P. Post-migration snapshot procedure

Same script after Complete; compare PRE → SOURCE → POST. Finance pilots require R0.00 + statement/Fee Check MATCH + COMPLETE_ACCEPTED.

---

## Q. Finance hard gate

Non-negotiable: source total = EduClear authoritative total, difference **R0.00**; per-account reconciliation pass; Statement MATCH; Fee Check MATCH; Accept succeeds.

---

## R. Pilot school selection criteria

Cooperative, manageable size, recognizable exports, finance export if full path, verification available, non-catastrophic rollback impact. **Not Da Silva as default first pilot.** No school selected in Phase 1O.

---

## S. Actual-export disposable rehearsal procedure

REAL EXPORTS → disposable EduClear school → Upload → Analyse → Review → Complete → Verify. Mandatory before real target write. **Not executed in 1O.**

---

## T. Operator runbook

`docs/universal-migration-controlled-pilot-runbook.md`

---

## U. Operator STOP conditions

Listed in runbook (wrong school, finance ≠ R0.00, authority mismatch, BLOCKED/FAILED unclear, duplicates, fingerprint drift, lock/storage unavailable, destructive schema prompts, unsure matches).

---

## V. Complete confirmation safety

UI hardened: confirm dialog shows target school name/id, file count/names, readiness, blocking count, finance applicability, explicit WRITE warning. Cancel aborts.

---

## W. Wrong-school protection results

Phase 1C unit PASS; Phase 1N/1O RC e2e isolation + readiness mismatch PASS (`AB_isolation`, multi-school lock). Complete rejects mismatched `targetSchoolId`.

---

## X. Rollback strategy

- **L1 Application:** stop; redeploy prior known-good pair; preserve evidence
- **L2 Data:** stop; preserve evidence; decision authority required; full DB restore is **not** casual default (cross-school impact); prefer proven school-scoped recovery only if independently proven

---

## Y. Pilot observability checklist

Status, domains, blocking/warnings, fingerprint, finance R0.00, statement, Fee Check, Accept, lock health — UI first; logs only on failure.

---

## Z. Pilot audit package

Defined in ops doc (school, manifests, snapshots, decisions, run id, finance/statement/fee/accept, verdict, timestamps, release SHA). No secrets.

---

## AA. Acceptance certificate design/status

Concept documented; **not** generated for a real school in Phase 1O.

---

## AB. RC full-scale disposable rehearsal

| Metric | Result |
|--------|--------|
| Learners | 600 |
| Parents | 450 |
| Links | 600 |
| Classrooms | 30 |
| Subjects | 14 |
| Accounts | 450 |
| Source finance cents | 4,320,777 |
| EduClear finance cents | 4,320,777 |
| Difference | **0 (R0.00)** |
| Statement | MATCH / verified |
| Fee Check | MATCH / verified |
| Accept | ACCEPTED |
| Terminal | COMPLETE_ACCEPTED (`S_terminal` PASS) |
| Analyse ms | 235 |
| Complete ms | 7,332 |
| Total ms | 8,169 |
| Manual mappings | 0 |
| Review decisions | 1 |
| Verdict | **GO** |

Log: `/tmp/phase1o-rc-e2e.log`

---

## AC. RC idempotency

PASS (`V_idempotent`, `V_no_dupes`) — counts unchanged on Complete replay.

---

## AD. RC interruption / recovery

PASS (`X_interrupt`, `X_no_parent_dupes`).

---

## AE. RC concurrency

PASS (`AA_double_complete`, `AA_crashed_lock`).

---

## AF. RC source-change handling

PASS (`Y_source_change_fp`, `Y_stale_matrix`, `Y_identical`).

---

## AG. RC multi-school isolation

PASS (`AB_multi_school_lock`, `AB_isolation`).

---

## AH. Full RC regression suite

PASS: phase1b–phase1m, parentIdConflict, parentIdPersist, applicationParentIdentity, privilegedAuth, parentFeeCheckService.

---

## AI. Backend / frontend builds

| Check | Result |
|-------|--------|
| Backend `tsc --noEmit` | PASS |
| Backend production build | PASS |
| Frontend `tsc --noEmit` | PASS |
| Frontend production build | PASS |

---

## AJ. Release diff review

- `simulateFailAt` HTTP exposure **fixed** in RC (`b849515`) — ignored unless `ALLOW_DISPOSABLE_MIGRATION_E2E=true`
- No temp credentials / local DB URLs in migration runtime
- Da Silva IDs in unrelated pre-existing modules only; snapshot script refuses prod school by default
- Authority gates intact

---

## AK. Migration security review

- Super Admin allowlist via `requireMigrationAccess`
- School scoping + mismatch rejects
- Uploads under school/project paths with resolve checks in project paths helper
- No arbitrary file execution path found in orchestrator
- Sensitive identity: matching/audit only; operator UI should avoid unnecessary full-ID display (restriction to keep monitoring)
- Normal school users cannot call migration APIs

---

## AL. Source-file retention / privacy

Uploads live under ephemeral `uploads/migration-staging/`. **No formal retention/cleanup policy** → **PILOT RESTRICTION**: treat exports as highly sensitive; export audit package; plan cleanup policy before broader rollout. Do not delete real files in 1O.

---

## AM. Future deployment plan (DO NOT EXECUTE)

1. Confirm RC SHA/tree  
2. Confirm backup  
3. Confirm persistent disk  
4. Confirm env (`ALLOW_DISPOSABLE_MIGRATION_E2E` unset)  
5. `prisma migrate deploy` for school-scoped Parent unique (if pending)  
6. Deploy backend + verify health  
7. Deploy frontend + verify Migration Center  
8. **Stop — deployment ≠ migration**  
9. Read-only smoke  
10. Real-export disposable rehearsal  
11. Explicit authorization  
12. Then Pilot #1  

---

## AN. Post-deploy / pre-pilot smoke plan

Login; Migration Center loads; school select; unauthorized denied; `data/migration-orchestrator/locks` creatable; no startup DB mutation; dashboards/Fee Check/statements/Parent Portal read smoke.

---

## AO. Finance cutover procedure

Record export timestamp + source total; freeze source during window; if source drifts, new export + reanalyse; never Accept stale export as “current.”

---

## AP. Pilot success criteria

Correct school; counts; R0.00 if finance; statement/Fee Check MATCH; COMPLETE_ACCEPTED; no duplicates; no cross-school impact; usable school; operator one-upload path.

---

## AQ. Pilot failure criteria

Wrong-school write; finance ≠ R0.00; false Accept; duplicates; unsafe merge; cross-family/portal exposure; cross-school contamination; authority mismatch; unrecoverable state; concurrent corruption; ephemeral artifacts lost mid-flight; destructive DB behavior.

---

## AR. Remaining release blockers

**None absolute for a carefully restricted controlled pilot**, provided:

1. Schema migration is applied via `migrate deploy` (not push) before/at deploy  
2. Production remains single-instance shared `data/` disk  
3. Pilot window avoids restart between upload and evidence export  

If multi-instance without shared disk, or restart-resilient reopen is required → escalate to **NOT READY**.

---

## AS. Remaining pilot restrictions

1. Continuous migration window (ephemeral `storage/`/`uploads/`)  
2. Trained Super Admin only  
3. One school; not Da Silva default  
4. Mandatory disposable real-export rehearsal first  
5. Deployment does not authorize migration  
6. Source-file retention policy undefined  
7. Full DB restore not default rollback  
8. Schema migrate deploy must be explicitly authorized with deploy  

---

## AT. Non-blocking improvements

Move orchestrator/stage/evidence stores under `data/`; formal upload retention/cleanup; richer non-`window.confirm` modal; acceptance certificate generator; `_prisma_migrations` drift cleanup on local/dev DBs.

---

## AU. Exact files changed during Phase 1O

**Phase 1O evidence tree (uncommitted overlay + docs):**

- Overlay = Phase 1N approved migration set  
- Added:  
  - `docs/universal-migration-controlled-pilot-runbook.md`  
  - `docs/universal-migration-pilot-prep.md`  
  - `docs/universal-migration-pilot-ops.md`  
  - `docs/universal-migration-persistent-artifact-audit.md`  
  - `docs/universal-migration-phase1o-change-inventory.md`  
  - `docs/universal-migration-phase1o-report.md` (this file)  
  - `backend/src/scripts/migrationPilotSchoolSnapshot.ts`  
  - Complete confirmation hardening in `UniversalMigrationOrchestratorSection.tsx`  
  - `simulateFailAt` HTTP gate in `backend/src/routes/migration.ts`

**RC commits:** assembly + simulateFailAt gate (see §E).

---

## AV. Pilot readiness decision

**IS THE ASSEMBLED UNIVERSAL MIGRATION RELEASE CANDIDATE SAFE TO DEPLOY FOR THE PURPOSE OF A CONTROLLED PILOT?**

**YES — WITH THE RESTRICTIONS IN §AS** (local commits only; still requires separate deploy authorization).

**AFTER DEPLOYMENT AND SAFE SMOKE TESTING, WOULD IT BE APPROPRIATE TO AUTHORIZE ONE CONTROLLED REAL-SCHOOL PILOT?**

**ONLY AFTER** verified backup + disposable real-export rehearsal PASS + explicit separate approval.  
**Not automatic. Not in this phase.**

---

## AW. UX verdict

**CAN A TRAINED SUPER ADMIN PERFORM THE PILOT USING UPLOAD → REVIEW EXCEPTIONS → COMPLETE MIGRATION WITHOUT MANUAL FIELD MAPPING OR DEVELOPER ASSISTANCE?**

**YES** — RC rehearsal: 0 manual mappings, 1 genuine review decision, Dry Run/Analyse clicks = 0, one Complete action (+ idempotent replay).

---

## AX. Explicit confirmations

- No production business-data writes  
- No real-school migration  
- No Da Silva Academy writes  
- No deployment  
- No push  
- No merge to main  
- No Prisma db push  
- No destructive schema change  
- No new migration domain  
- Prior Phase 1B–1N worktrees unchanged  
- Release candidate assembled only from approved changes  
- Core / parent identity / parent-family / academic / finance / statement / Fee Check / Accept authorities preserved  

---

## STOP

Phase 1O complete. Next action requires separate explicit approval.
