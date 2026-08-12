# Universal Migration — Phase 1O Approved Change Inventory

Base: `origin/main` @ `5e8547b329111bea5146cedda4ca3f9ca1d84837`

Classification key:
- **APPROVED_MIGRATION_RUNTIME** — production runtime for Universal Migration / identity / finance authority
- **APPROVED_MIGRATION_TEST** — unit/e2e harness supporting the above
- **APPROVED_MIGRATION_DOCUMENTATION** — pilot prep / runbooks (Phase 1O)
- **SCHEMA_REQUIRED** — Prisma school-scoped Parent.idNumber (non-destructive unique change)
- **EXCLUDE_ARTIFACT** — ephemeral storage/uploads/local dumps (never ship)
- **PRE-EXISTING / UNRELATED** — not included in RC
- **UNCERTAIN** — none remaining in RC

## Release candidate file set (82 paths)

See `/tmp/phase1o-rc-manifest.txt` and RC worktree dirty set.

### Runtime (production-dependent)

| Path | Purpose | Data behavior | Finance/identity/security |
|------|---------|---------------|---------------------------|
| `backend/src/routes/migration.ts` | Migration APIs | Yes | Auth + school scope |
| `backend/src/routes/learner.ts` | Learner parent ID paths | Yes | Identity |
| `backend/src/routes/parents.ts` | Parent ID paths | Yes | Identity |
| `backend/src/services/applicationParentIdentity.ts` | Application parent identity | Yes | Identity |
| `backend/src/services/migration/**` (core/orchestrator/finance/academic/parentFamily/parentIdentity/sourceAnalysis/migrationPlan/staging/adapters) | Universal Migration | Yes | All authorities |
| `backend/src/services/financeAuthority/**` | Shared balance resolver | Yes | Finance |
| `backend/src/services/parentFeeCheckService.ts` | Fee Check | Read/write age analysis | Fee Check |
| `backend/src/utils/parentIdConflict.ts` | Parent ID conflict | Yes | Identity |
| `backend/src/utils/billingDisplayRules.ts` | Display rules | Display | Finance display |
| `backend/src/utils/familyAccountAgeAnalysisStore.ts` | Age analysis store | Yes | Fee Check |
| Frontend Migration Center + orchestrator + domain sections + utils | Operator UX | Triggers APIs | Operator gates |
| `frontend/src/learner/parentIdConflict.ts` | FE conflict helpers | Client | Identity |
| `frontend/src/SchoolDashboard.tsx` | Tiny parent-identity related | Minor | Identity UX |

### Schema

| Path | Notes |
|------|-------|
| `backend/prisma/schema.prisma` | `@@unique([schoolId, idNumber])` |
| `backend/prisma/migrations/20260811120000_parent_idnumber_school_scoped_unique/` | Deploy via `migrate deploy` only |
| `backend/scripts/check-parent-idnumber-school-scoped-compat.ts` | Compat check (ops) |

### Tests

Phase 1B–1N unit tests + parent identity / Fee Check / privileged auth tests listed in RC status.

### Explicitly excluded from RC

- `backend/storage/**` harness artifacts
- Payroll / EduClock / attendance / HomeSafe / ScriptCheck / MBB emergency tooling
- Unrelated Super Admin / billing features outside migration authority path

## Uncertain → resolved

- `migrationFinanceFormat.ts` → APPROVED_MIGRATION_RUNTIME (cents display)
- `SchoolDashboard.tsx` (+2 identity) → APPROVED_MIGRATION_RUNTIME
