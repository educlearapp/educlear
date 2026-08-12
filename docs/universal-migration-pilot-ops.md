# Universal Migration — Backup, Snapshot, Rollback, Observability

## Backup (execute only immediately before authorized Pilot #1)

1. Create production DB backup via platform/provider tooling.
2. Record: backup identifier, timestamp (UTC), operator, retention (min 30 days recommended).
3. Verify backup completed (provider status = success; size non-zero).
4. Capture target-school pre-migration snapshot (see script below).
5. Archive school export package + content fingerprints.
6. Confirm `backend/data` persistent disk healthy (billing ledger present; writable).

Do **not** run production backup as part of Phase 1O.

### Pre-migration snapshot

```bash
cd backend
ALLOW_DISPOSABLE_MIGRATION_E2E=true npx tsx src/scripts/migrationPilotSchoolSnapshot.ts --schoolId=<TARGET>
```

Captures: learner/parent/link/classroom/subject/account counts; ledger debit/credit/net cents.

Also record (manual/API where available): invoice/payment/credit counts if used; statement baseline status; Fee Check authority state.

### Post-migration snapshot

Re-run the same script after Complete Migration. Compare PRE → SOURCE → POST for counts and finance cents. Finance-bearing pilots require difference **R0.00**, Statement MATCH, Fee Check MATCH, COMPLETE_ACCEPTED.

## Rollback

### Level 1 — Application rollback

Use when code/UI misbehaves **before** harmful data writes (or immediately after detecting unsafe behavior with no confirmed corruption):

1. STOP migration.
2. Redeploy prior known-good application release (backend + frontend pair).
3. Preserve migration evidence directories if still present.
4. Do not re-attempt Complete until RC defect is fixed.

### Level 2 — Data rollback

Use only if confirmed pilot-school data corruption:

1. STOP all migration activity.
2. Preserve evidence (exports, snapshots, run ids, reconciliations, logs).
3. Decision authority: engineering lead + product owner.
4. Prefer school-scoped recovery **only if independently proven**; otherwise consider full DB restore from pre-pilot backup.
5. Full DB restore impacts **other schools** that changed after backup — not a casual default.
6. Never invent ad-hoc delete scripts during an incident.

## Observability checklist (during pilot)

Operator-facing (prefer UI over raw logs):

- [ ] Migration overall status
- [ ] Current domain / progress step
- [ ] Blocking / warning counts
- [ ] Source fingerprint stable
- [ ] Finance reconciliation difference = R0.00 (if finance)
- [ ] Statement Authority MATCH
- [ ] Fee Check Authority MATCH
- [ ] Accept / terminal COMPLETE_ACCEPTED
- [ ] Lock acquired / released without orphan errors

Escalate to logs only on FAILED/BLOCKED/unclear retry.

## Pilot audit package (retain after Pilot #1)

- Pilot school id/name
- Source file manifest + fingerprints
- Pre-migration snapshot
- Operator review decisions
- Migration run id
- Apply results
- Finance reconciliation
- Statement + Fee Check + Accept results
- Post-migration snapshot
- Warnings
- Final verdict
- Timestamps
- Release SHA / tree SHA

No secrets, tokens, or DATABASE_URL.

## Acceptance certificate (concept)

```
UNIVERSAL MIGRATION — PILOT RESULT
School: [School]
Learners: PASS|FAIL
Parents & Families: PASS|FAIL
Academic Structure: PASS|FAIL
Finance: PASS — R0.00 difference | FAIL | N/A
Statements: PASS|FAIL|N/A
Fee Check: PASS|FAIL|N/A
Acceptance: COMPLETE_ACCEPTED|…
Warnings: N
Final Result: SUCCESS|FAIL
Release: [SHA]
```

Generate only for authorized pilot; not in Phase 1O against a real school.
