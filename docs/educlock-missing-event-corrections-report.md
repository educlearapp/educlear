# EduClock missing-event corrections + attendance-date binding

## A. Verdict

**READY TO RELEASE EDUCLOCK MISSING-EVENT CORRECTIONS**

Not deployed. No production attendance write. Owner corrections now bind to the selected attendance row/date, and the same dialog/API supports missing clock-in, missing clock-out, and both-missing reconstruction.

## B. Isolation / SHAs

| Item | Value |
|---|---|
| Worktree | `/private/tmp/educlear-educlock-correction-release` |
| Branch | `fix/educlock-missing-events-date-binding` |
| Starting tree / current HEAD | `6798a05f40f31d9a89c49df66c6ada2949482c2d` |
| Production frontend SHA (live) | `6798a05f40f31d9a89c49df66c6ada2949482c2d` (explicit Hour / Minute / AM-PM selector) |
| Production backend SHA (live) | `e08cb75c2d80babb7dafab2ebc7ba8d4bfd67582` |
| Parent migration RC | `b39ad5f` |
| Uncommitted work | this phase (not committed) |

Not modified: Phase 1Q, Phase 1Q-A, Migration Center, payroll pairing policy, GPS/geofence.

## C. Date-binding root cause

Traced path:

1. Daily Attendance row for the viewed school-local date groups **that day's** `EduClockEvent`s.
2. `lastIn && !lastOut` on **2026-08-12** yields status **Missing Clock Out**, `affectedSchoolLocalDate = 2026-08-12`, clock-in **06:35**.
3. The dialog sends `schoolLocalDate` from that row (`target.affectedSchoolLocalDate`).
4. Production backend `ownerCreateCorrection` treated the employee's unique `EduClockOpenShift` (`@@unique([schoolId, employeeId])`) as date authority for `CLOSE_OPEN_SHIFT` / `ADD_CLOCK_OUT`.
5. If a later event created a **13 August** open shift, `openPreview.schoolLocalDate === 2026-08-13`.
6. Saving the **12 August** row was rejected with: `schoolLocalDate must match the affected attendance date 2026-08-13`.

This is the Micaela pattern: a 12 August unmatched clock-in can still render as Missing Clock Out on the 12 August board while the current open shift belongs to another day. The selected row was not the authority.

Not caused by Safari time input, browser TZ, or `createdAt`. School TZ conversion of `YYYY-MM-DD + HH:mm + +02:00` was already correct when the date itself was right (Jemmah).

## D. Attendance-date authority

For Owner corrections, **the selected attendance date is authoritative**.

- `attendanceDate = requested schoolLocalDate` (YYYY-MM-DD).
- Clock-in is resolved from `targetEventId` **on that date**, else the last `CLOCK_IN` on that date.
- If `targetEventId` is a clock-in on a **different** date, the API rejects with that event's date (Owner cannot retarget an unrelated day).
- If that date has no clock-in, `CLOSE_OPEN_SHIFT` / `ADD_CLOCK_OUT` returns 409.
- `EduClockOpenShift` is closed **only if** `open.clockInEventId` matches the clock-in being closed. A later day's open shift is left alone.
- Binding used: `schoolId + employeeId + schoolLocalDate + clockInEventId`. No new table / Prisma schema.

## E. Missing Clock In workflow

Attendance board now surfaces `lastOut && !lastIn` as **Missing Clock In**.

Dialog (same Owner workflow):

- Shows employee, number, selected date, Clock In: **Missing**, existing Clock Out, status.
- Shows only **Correct Clock In time** (Hour / Minute / AM-PM).
- Canonicalises to `HH:mm`.
- Action: `ADD_CLOCK_IN`.
- Default reason: **Forgot to clock in**.

Backend:

- Rejects if a clock-in already exists that day.
- Rejects clock-in after a known same-day clock-out.
- Does not invent a clock-out.
- Does not create a second open shift if another day's open shift already exists (unique constraint preserved).

## F. Missing Clock Out workflow

Preserved.

- Clock In present, Clock Out missing → only **Correct Clock Out time**.
- Same explicit Hour / Minute / AM-PM control (no `input type="time"`).
- Action: `CLOSE_OPEN_SHIFT`.
- Default reason: **Forgot to clock out**.
- Jemmah-style 07:18 → 16:00 = **8h 42m** still passes.

**Both missing (`Not Clocked In`):** the board already emits a row for employees with no events that day. The dialog shows both selectors and **requires both times**. Backend `ADD_CLOCK_IN` plus optional `schoolLocalClockOutTime` creates the pair in one transaction. Neither timestamp is invented.

## G. Timezone behaviour

Corrections are `schoolLocalDate + canonical HH:mm` interpreted as `Africa/Johannesburg` (`+02:00`).

Examples:

- `2026-08-12` + `06:35` → `2026-08-12T06:35:00+02:00` (`2026-08-12T04:35:00.000Z`)
- `2026-08-12` + `15:02` → `2026-08-12T15:02:00+02:00`
- `2026-08-12` + `23:59` → `2026-08-12T23:59:00+02:00` (`2026-08-12T21:59:00.000Z`) — stays 12 August, not UTC 13 August

Rejected: locale `04:00 PM`, malformed `16`, impossible `25:61`, non-ISO dates.

## H. Following-day event regression

Synthetic Case B (Micaela pattern, **not** production Micaela):

- 12 Aug `CLOCK_IN` 06:35, no 12 Aug out
- 13 Aug `CLOCK_IN` + open shift on 13 Aug
- Owner corrects the **12 Aug** row to 15:02

Result:

- Correction `schoolLocalDate = 2026-08-12`
- Does **not** error with `must match … 2026-08-13`
- 13 Aug open shift remains
- 12 Aug `MISSING_CLOCK_OUT` exception resolved; 13 Aug exception stays OPEN
- 12 Aug board: Clocked Out, 8h 27m, `OWNER_MANUAL`, Corrected

A later event on a new attendance day is a separate row.

## I. Audit

Append-only. Original mobile events are not overwritten.

Each correction stores:

- school, employee, attendance date
- original clock-in / clock-out
- corrected clock-in / clock-out
- reason, notes
- corrected by, corrected at
- `source = OWNER_MANUAL`, `isManualCorrection = true`, `correctedFromEventId` when closing an existing in

A resolved `MANUAL_CORRECTION` exception is also written as an audit marker.

## J. Exception lifecycle

Prisma `EduClockExceptionType` has **no** `MISSING_CLOCK_IN` (and none was added).

| Defect | Exception today | After successful correction |
|---|---|---|
| Missing Clock Out (stale open shift) | `MISSING_CLOCK_OUT` OPEN, created when open shift date &lt; today | That **date's** `MISSING_CLOCK_OUT` rows resolved. Unrelated dates untouched. |
| Missing Clock Out on a day whose open shift has moved to a later day | Board status only; open-shift scanner may not create a 12 Aug exception | If an OPEN `MISSING_CLOCK_OUT` exists for that date, it is resolved. |
| Missing Clock In | Board status **Missing Clock In**. Payroll warning `MISSING_CLOCK_IN`. No dedicated exception type. | No `MISSING_CLOCK_OUT` is marked resolved. `MANUAL_CORRECTION` audit exception is created. |
| Duplicate clock attempt | Informational; not actionable here | Remains OPEN |

Do not add a Prisma enum without a separate schema decision.

## K. Duration

Existing `durationBetweenClockEvents` / `formatWorkedDurationMs`. Historical missing out still displays `—` (not `now - clockIn`).

| Pair | Duration |
|---|---|
| 07:18 → 16:00 | 8h 42m |
| 06:35 → 15:02 | 8h 27m |
| 07:18 → 15:00 | 7h 42m |

After both authoritative sides exist, Daily Attendance uses the paired times.

## L. Reporting

Same event stream feeds:

- Daily Attendance (`getOwnerAttendance`) — post-correction status, times, duration, `OWNER_MANUAL`, Corrected badge
- Exceptions — missing-out resolution for that date only
- Event history / owner event GET — original + append-only correction
- Payroll pairing — chronological effective events; policy unchanged

Learner class-attendance PDF/CSV reports are a different subsystem and were not changed.

No screen in this workflow keeps the pre-correction missing state after a successful save + reload.

## M. Payroll safety

Policy **not** changed.

- Unmatched clock-in → 0 payable minutes (`MISSING_CLOCK_OUT`)
- Unmatched clock-out → 0 payable minutes (`MISSING_CLOCK_IN`)
- Only a valid IN→OUT pair contributes
- After Case C pair exists: 06:35–15:02 = **507 minutes**

Owner correction does not invent a clock-out for payroll.

## N. Tests

Passed:

- `frontend/src/educlock/educlockCorrectionUi.test.ts`
- `backend/src/routes/educlock.corrections.route.test.ts` (Case A / Jemmah, Case B following-day, Case C / Zahne-like, both-missing, midnight, authz, TZ)
- `backend/src/services/educlockAttendanceDuration.test.ts`
- `backend/src/services/payrollEduClockPairing.test.ts`
- `backend/src/services/payrollEduClockCorrectionResolution.test.ts`

Coverage includes: selected-date binding; following-day cannot hijack; missing in/out; school TZ; explicit selector; in-after-out and out-before-in rejected; wrong school 404; unauth 401; teacher 403; original events preserved; audit; `OWNER_MANUAL` + Corrected; exception resolution for that date; duration; payroll 0-minutes unmatched.

`educlock.build3.route.test.ts` failed at staff clock-in with `NO_ACTIVE_BOUNDARY` (campus GPS). Out of scope; GPS/geofence not changed. Correction regressions above passed independently.

## O. Builds

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | PASS |
| Backend `npm run build` | PASS |
| Frontend `tsc -p tsconfig.app.json --noEmit` | PASS |
| Frontend `npm run build` | PASS (`dist/assets/index-BKN7bQQp.js`) |

## P. Exact files changed

- `backend/src/services/educlockClockService.ts`
- `backend/src/routes/educlock.ts`
- `backend/src/routes/educlock.corrections.route.test.ts`
- `backend/src/services/educlockAttendanceDuration.test.ts`
- `backend/src/services/payrollEduClockPairing.test.ts`
- `frontend/src/educlock/educlockApi.ts`
- `frontend/src/educlock/educlockCorrectionUi.ts`
- `frontend/src/educlock/educlockCorrectionUi.test.ts`
- `frontend/src/educlock/EduClockCorrectionDialog.tsx`
- `frontend/src/educlock/EduClockAttendanceTab.tsx`
- `docs/educlock-missing-event-corrections-report.md` (this file)

## Q. Schema confirmation

**SCHEMA_CHANGE = NO**

No Prisma migration. No `db push`. Open-shift uniqueness unchanged.

## R. Production writes

None.

No correction of Micaela, Zahne, or Jemmah. No direct DB edit. No bulk scripts. Synthetic employees only (`EMP0020SYN`, `EMP0045SYN`, `EMPNCI01`, …).

## S. Release recommendation

Release **backend and frontend together** from this branch after commit + review.

Backend must ship: without it, date binding and missing clock-in remain broken in production (`e08cb75`). Frontend must ship: missing-in fields and row-date payload.

Do **not** deploy from this phase.

Production Owner validation after deploy (read-only until then):

1. Micaela 12 Aug row should save as 12 Aug, not 13 Aug.
2. Zahne-style missing clock-in / not-clocked-in should accept an explicit clock-in (and both times when neither side exists).

---

NO PRODUCTION ATTENDANCE WRITE

NO DIRECT PRODUCTION DB EDIT

NO PRISMA DB PUSH

NO SCHEMA CHANGE

NO MIGRATION CENTER CHANGE

NO DEPLOYMENT FROM THIS PHASE
