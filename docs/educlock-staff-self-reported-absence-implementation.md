# EduClock staff self-reported absence — implementation report

**Verdict:** PASS WITH RESTRICTIONS (local implementation complete; not released)

| Item | Value |
|---|---|
| Worktree | `/private/tmp/educlear-educlock-staff-absence` |
| Branch | `feature/educlock-staff-self-reported-absence` |
| Starting SHA | `9157ab8608709df8d71329c37dd9f3748d6bcad0` |
| Isolation | Historical correction branch and 12 August 2026 production attendance were not touched |

Absence is **not** an `EduClockEvent`. Payroll still pairs CLOCK_IN → CLOCK_OUT only.

---

## Schema

`EduClockStaffAbsence` with enums:

- `EduClockAbsenceReason`: SICK, FAMILY_RESPONSIBILITY, EMERGENCY, MEDICAL_APPOINTMENT, APPROVED_LEAVE, UNPAID_LEAVE, TRAINING_OFFICIAL_DUTY, OTHER
- `EduClockAbsenceApprovalStatus`: REPORTED, AUTHORISED, UNAUTHORISED, CANCELLED
- `EduClockAbsenceSource`: STAFF_SELF_REPORT

Unique: `(schoolId, employeeId, schoolLocalDate)` — one row per employee per school-local day (cancel updates the same row; original reason/note/`reportedAtUtc`/`reportedByUserId` are never overwritten).

## Migration

Filename: `backend/prisma/migrations/20260814120000_educlock_staff_self_reported_absence/migration.sql`

Additive only: CREATE TYPEs, CREATE TABLE, unique + indexes, FKs to School/Employee CASCADE. No `EduClockEvent` changes, no drops.

Local `prisma migrate deploy` on `educlear` is blocked by a **pre-existing unrelated** failed migration `20260806120000_attendance_session_subjects`. The absence SQL was applied locally with psql, then `prisma migrate resolve --applied` for this migration only. **Production migrate was not run.**

## Staff API

`POST /api/educlock/me/absence` — `requireStaffAuth` + `rejectClientIdentityFields` + `resolveActivatedEmployeeForClock`. Backend derives school-local today (`Africa/Johannesburg`). Always creates `REPORTED` / `STAFF_SELF_REPORT`.

Owner: `POST /api/educlock/owner/absences/:absenceId/cancel` — `requireEduClockManage`. Does not fabricate CLOCK_IN.

## Reports

The EduClock Reports tab remains a placeholder. Future reports **must consume `EduClockStaffAbsence`**. Do not infer absence from missing clock-in or invent clock times.

## Remaining restrictions

- Cancelled rows still occupy the unique `(school, employee, date)` slot; staff cannot re-report the same day after cancel (they can clock in).
- AUTHORISED / UNAUTHORISED are schema-ready but unused.
- No payroll deduction, leave balance, or payslip changes.
- No production deploy / push / merge.
