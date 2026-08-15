# EduClock employee self-reported absence — architecture review

**Status:** architecture approved and implemented locally. See `docs/educlock-staff-self-reported-absence-implementation.md`.

Original STOP verdict is retained below as the investigation record.

| Item | Value |
|---|---|
| Worktree | `/private/tmp/educlear-educlock-staff-absence` |
| Branch | `feature/educlock-staff-self-reported-absence` |
| Starting / HEAD SHA | `9157ab8608709df8d71329c37dd9f3748d6bcad0` (production missing-event correction release) |
| Isolation | Does not modify `fix/educlock-missing-events-date-binding` working tree or 12 August records |

---

## E. Architecture discovered

### Authentication and identity

Staff EduClock uses JWT staff session, not a client-supplied employee id.

- Route gate: `requireStaffAuth` in `backend/src/routes/educlock.ts` — session `userId` + `authorizedSchoolId`; mismatch → 403.
- Clock identity: `resolveActivatedEmployeeForClock` in `backend/src/services/educlockClockService.ts`.
  - Loads `user.linkedEmployee` for the session user.
  - Requires same `schoolId`, active user, active employee, linked `userId`, employee number, identity document.
- Clock-in / clock-out routes (`POST /api/educlock/me/clock-in`, `/me/clock-out`) pass only `auth.userId` and `auth.authorizedSchoolId`. Client `employeeId` / `schoolId` are rejected for staff clock (`rejectClientClockOverrides`).

Owner attendance uses `requireEduClockManage` (`educlock.manage`). School always comes from session.

### Clock In / Clock Out

- `staffClockIn` / `staffClockOut` create append-only `EduClockEvent` rows (`CLOCK_IN` / `CLOCK_OUT`, source `STAFF_MOBILE`).
- At most one open shift per employee: `EduClockOpenShift` `@@unique([schoolId, employeeId])`.
- GPS validation can reject; rejected attempts go to `EduClockGpsAttempt`, not attendance.
- Idempotency: `EduClockIdempotencyKey` on `schoolId + userId + operation + key`.

### Attendance storage

`EduClockEvent` is the source of truth. Types today:

```
enum EduClockEventType { CLOCK_IN, CLOCK_OUT }
enum EduClockEventSource { STAFF_MOBILE, OWNER_MANUAL, SYSTEM }
```

Daily Owner board (`getOwnerAttendance`) classifies **that school-local date’s events**:

| Condition | Status |
|---|---|
| No IN, no OUT | **Not Clocked In** |
| IN, no OUT | Missing Clock Out / Clocked In (if live open shift today) |
| OUT, no IN | Missing Clock In |
| IN then later OUT | Clocked Out |

**Absence is never inferred from a missing clock-in.** That matches the product rule, but there is also **no place to store an explicit absence today**.

### Owner views and reports

- Owner shell: `frontend/src/educlock/EduClock.tsx` — Overview, Staff, Attendance, Exceptions, Geofences, Reports, Settings.
- Daily board: `EduClockAttendanceTab.tsx` ← `GET /api/educlock/owner/attendance`.
- Exceptions: `EduClockExceptionsTab.tsx` (missing clock-out, duplicates, corrections).
- Staff self-service: `EduClockStaffClockPage.tsx` — primary Clock In / Clock Out only. Status display treats “not in” as “Clocked Out” when there is no open shift (including never clocked today).
- **Reports tab is placeholder copy** (Daily Attendance, Timesheets, Payroll Export, etc. — not implemented). Learner class registers (`attendanceReportService`, Present/Absent/Late) are a **different subsystem** and must not be reused for staff EduClock.

### Corrections

`ownerCreateCorrection` (`POST /api/educlock/owner/corrections`) is Owner-only, append-only `OWNER_MANUAL` events, selected-date authority. Must stay unchanged in this feature. Historical 12 August work stays on the other branch.

### Timezone

`DEFAULT_SCHOOL_TIMEZONE` = `Africa/Johannesburg`. Official date/time from `resolveSchoolLocalParts(server now)`. Staff UI live clock is display-only.

### Existing leave / absence

**None in EduClock or Employee Prisma models.** Learner “ABSENT / Sick” reason codes and Homesafe `SICK` are unrelated.

### Payroll

`payrollEduClockPairing.ts` pairs **only** `CLOCK_IN` → next `CLOCK_OUT`. Unmatched IN/OUT → 0 payable minutes + warnings. Unknown event types are not paired.

Implication: a dedicated absence row that is **not** CLOCK_IN/CLOCK_OUT would **not** create payable minutes and would **not** by itself deduct salary. Payroll must still be left unchanged until explicitly approved. Self-report must **not** be treated as authorised paid leave.

---

## Why existing tables cannot hold this feature

| Approach | Why it fails |
|---|---|
| Fake `CLOCK_IN` / `CLOCK_OUT` | Board would show Clocked In/Out; invents times; corrupts payroll pairing. |
| `EduClockException` with existing enum | Types are missing-out, duplicate clock, invalid sequence, manual correction, activation blocked. No unique “one absence per day”. `OPEN`/`RESOLVED` ≠ Reported/Approved. |
| Sidecar JSON / second store | Second attendance architecture. |
| Learner attendance registers | Different product; learners not employees. |

A distinguishable **Absent — Sick** state, today-only uniqueness, audit, and clock-in block require a **first-class absence record**.

---

## Proposed model (not applied)

Smallest EduClock-native addition. **Do not implement until approved.**

### Enums

```prisma
enum EduClockAbsenceReason {
  SICK
  FAMILY_RESPONSIBILITY
  EMERGENCY
  MEDICAL_APPOINTMENT
  APPROVED_LEAVE
  UNPAID_LEAVE
  TRAINING_OFFICIAL_DUTY
  OTHER
}

enum EduClockAbsenceApprovalStatus {
  REPORTED          // employee self-report; not paid-leave authority
  AUTHORISED        // future Owner action — out of this phase’s write path
  NOT_AUTHORISED    // future Owner action
}

enum EduClockAbsenceSource {
  STAFF_SELF_REPORT
}
```

Display labels (frontend/API, not DB):

- Sick
- Family Responsibility
- Emergency
- Medical Appointment
- Approved Leave *(employee claim only until Owner authorises)*
- Unpaid Leave
- Training / Official Duty
- Other

**Important:** reason `APPROVED_LEAVE` is the employee’s selected label, **not** management approval. Approval lives in `approvalStatus`, default `REPORTED`.

### Table

```prisma
model EduClockStaffAbsence {
  id                 String                         @id @default(cuid())
  schoolId           String
  employeeId         String
  employeeNumberSnapshot String
  schoolLocalDate    String                         // YYYY-MM-DD, school TZ
  timezone           String                         @default("Africa/Johannesburg")
  reason             EduClockAbsenceReason
  note               String?
  source             EduClockAbsenceSource          @default(STAFF_SELF_REPORT)
  approvalStatus     EduClockAbsenceApprovalStatus  @default(REPORTED)
  reportedAtUtc      DateTime
  reportedByUserId   String
  createdAt          DateTime                       @default(now())
  /// Append-only JSON: original report; later Owner resolutions appended, never overwritten.
  audit              Json

  school   School   @relation(...)
  employee Employee @relation(...)

  @@unique([schoolId, employeeId, schoolLocalDate])
  @@index([schoolId, schoolLocalDate])
}
```

### Constraints / behaviour

- Unique `(schoolId, employeeId, schoolLocalDate)` → one active self-report per day; retries return the existing row (idempotent).
- Server sets `schoolLocalDate` from school-local **today**. Ignore/reject client dates ≠ today (yesterday/tomorrow → 400).
- Employee id from session only.
- Reject if a `CLOCK_IN` exists for that employee/school/date **or** an open shift for today.
- After a `REPORTED` absence for today: `staffClockIn` returns 409 — contact management; do not create IN.
- Owner board: if absence exists and no same-day IN → status **Absent — {reason}**, no invented clock times; filter `ABSENT`.
- Staff status: `ABSENT` with reason; hide Clock In; hide Report Absent.
- Do not add `ABSENCE` to `EduClockEventType` (avoids payroll pairing accidents). Absence is parallel to events, not a fake clock.

### Migration

- `npx prisma migrate dev --name educlock_staff_self_reported_absence` **after approval**, never `db push`.
- Additive: new table + enums + relation fields on School/Employee.
- Rollback: `migrate resolve` / revert migration on non-prod; production rollback is migrate-down only if unused, else leave table unused.

### Compatibility

- Existing clock-in/out, corrections, GPS, open-shift uniqueness unchanged.
- Payroll pairing unchanged (still IN/OUT only).
- Historical 12 August events untouched.

### Owner approval (later, not this phase)

Read-only `REPORTED` is enough now. Authorise / not-authorise can be a later Owner action that **appends** audit JSON and updates `approvalStatus` without deleting the original report.

### Clock-in after absence (later)

Management resolution path (Owner correction or “arrived after reporting absent”) is **out of this phase** except the required 409 block + message.

---

## Intended implementation (after schema approval) — not built

1. `POST /api/educlock/me/absence` — staff auth, reason + optional note; Other requires note.
2. Extend `GET /api/educlock/me/status` with `absence`, `canReportAbsent`, `canClock`.
3. Block `staffClockIn` when today’s self-report exists.
4. `getOwnerAttendance` absence status + detail payload.
5. Staff UI: secondary **Report Absent** under Clock In; simple form; explicit confirm.
6. Tests A–H plus payroll “no extra pairs” and correction-route regression.

---

## Safety already held

- No real attendance writes
- No 12 August changes
- No prisma db push
- No deploy / push / merge
- Correction branch untouched
