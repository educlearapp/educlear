# EduClock attendance correction fix report

## A. Verdict

**READY FOR CONTROLLED EDUCLOCK CORRECTION RELEASE**

The Owner Correct workflow now opens a real modal, missing clock-out duration no longer accumulates across days, corrections are append-only and school-scoped, and the matching Missing Clock Out exception resolves automatically.

## B. Worktree / branch / starting SHA

| Item | Value |
|---|---|
| Worktree | `/private/tmp/educlear-educlock-corrections` |
| Branch | `fix/educlock-attendance-corrections` |
| Starting `origin/main` | `5e8547b329111bea5146cedda4ca3f9ca1d84837` |
| Current production-tracking SHA | `5e8547b329111bea5146cedda4ca3f9ca1d84837` (`Merge pull request #6 from educlearapp/cleanup/remove-mbb-temp-superadmin-ui`) |
| Starting worktree status | **clean** (created from `origin/main`) |
| Ending git status | dirty with this EduClock-only change set; **not committed, not pushed** |
| Isolated from | Phase 1Q / 1Q-A / migration RC worktrees and `/private/tmp/educlear-mbb-ui-cleanup` |

No Phase 1Q / 1Q-A / migration files were modified.

## C. Root cause of dead Correct button

The Correct button already had an `onClick`. It was not a missing handler.

`EduClockAttendanceTab` set `correctRow` and rendered a **below-the-table inline card** after pagination. That panel was not a modal (`role="dialog"`, `position: fixed`). On a populated attendance board the click produced no visible change in the row or viewport, so production Owners correctly reported that Correct “does nothing”.

A second defect made Save unsafe even if the panel was found:

- Submit used `data.schoolLocalDate` (the currently viewed filter date).
- Missing clock-outs are often surfaced on **today’s** board while the open shift belongs to a **previous** school-local date.
- Binding clock-out to today would either create a multi-day duration or fail confusingly.

Fix: shared `EduClockCorrectionDialog` overlay, and backend authority uses the **open shift’s affected attendance date**.

## D. Existing correction architecture

Reused; no competing correction system was added.

Existing model (preserved):

- Raw mobile events remain `EduClockEvent` rows (`source: STAFF_MOBILE`, `isManualCorrection: false`).
- Owner corrections append a new `EduClockEvent` (`source: OWNER_MANUAL`, `isManualCorrection: true`, `correctedFromEventId` → original clock-in).
- Original rows are never updated or deleted.
- `POST /api/educlock/owner/corrections` already existed (`ownerCreateCorrection`).
- Payroll already resolves terminal corrections via `payrollEduClockCorrectionResolution` without mutating events.

This change strengthens that path (audit metadata, date binding, exception resolution, UI).

## E. Missing clock-out duration root cause

In `getOwnerAttendance`, historical open shifts used:

`now - openedAtUtc`

That is the 26h / 50h 7m / 50h 41m symptom.

Synthetic reconstruction (Africa/Johannesburg):

| Clock-in | “Now” | Wrong `now - clockIn` | Correct display |
|---|---|---|---|
| 2026-08-11 07:27 | 2026-08-13 09:34 | **50h 7m** | **—** |
| 2026-08-11 06:53 | 2026-08-13 09:34 | **50h 41m** | **—** |
| 2026-08-12 07:18 | 2026-08-13 09:34 | 26h 16m class | **—** |

Rules now:

- `clockIn != null` and `clockOut == null` after the attendance-day cutoff → duration `null` (UI **—**), status **Missing Clock Out**.
- Same-day live open shift on today → live `now - clockIn` remains.
- Frontend also refuses to render accumulated hours for Missing Clock Out even if an old payload still contained them.

## F. Implemented correction workflow

Shared Owner workflow (Attendance → Correct **and** Exceptions → Correct Attendance):

1. Modal shows employee name + number, affected attendance date, original clock-in, clock-out **Missing**, status.
2. Owner enters clock-out time only (existing clock-in is not re-entered).
3. Owner selects a reason; **Other** requires notes.
4. Save calls the existing `POST /api/educlock/owner/corrections` with `CLOSE_OPEN_SHIFT`.
5. Backend:
   - binds timestamp to the **open shift school-local date** (rejects a mismatched viewed date);
   - rejects clock-out ≤ clock-in;
   - appends an owner correction event;
   - closes the open shift;
   - recalculates duration from original clock-in + corrected clock-out;
   - marks attendance **Clocked Out** + **Manually Corrected** / **Corrected** badge;
   - resolves the matching Missing Clock Out exception.

EMPTEST01 example (Africa/Johannesburg):

- Before: In 07:18, Out missing, duration —, Missing Clock Out, exception Open.
- Owner clock-out 15:00, reason “Forgot to clock out”.
- After: In 07:18, Out 15:00, duration **7h 42m**, Clocked Out, correction visible, exception Resolved, original event retained.

## G. Audit architecture

Append-only. Stored on the correction event `metadata` + `note`, and returned as `audit` on the POST response.

Minimum fields:

- `schoolId`
- `employeeId`
- `employeeNumber`
- `attendanceDate`
- `originalClockIn` / `originalClockOut`
- `correctedClockIn` / `correctedClockOut`
- `reason` (human-readable)
- `notes`
- `correctedByUserId`
- `correctedByRole`
- `createdAt`
- `resolutionSource: OWNER_ATTENDANCE_CORRECTION`

No identity document numbers or extra PII.

## H. Exception resolution

Missing Clock Out exceptions for that employee + affected date automatically move **Open → Resolved** when the underlying attendance is corrected.

Recorded:

- `resolvedByUserId`
- `resolvedAt`
- `resolutionSource = OWNER_ATTENDANCE_CORRECTION`
- `associatedCorrectionEventId`

Owner does not need a second “resolve exception” click.

**Duplicate Clock Attempt** stays independent (see L / P).

## I. Authorization / school isolation

Unchanged permission gate: `educlock.manage` (Owner all-permissions; Admin template includes manage; Teacher does not).

Server-side:

- unauthenticated → **401**
- Teacher / no manage → **403**
- employee from another school → **404**
- body/query `schoolId` mismatch → **403** (`EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH`)
- school always from authenticated session

Staff `/me/clock-out` cannot close a previous-day missing clock-out (would have created a payable multi-day pair). Same-day live clock-out is unchanged and still GPS-validated.

## J. Reporting consistency

Authoritative daily attendance is `getOwnerAttendance` (Owner Attendance + Overview counts). After correction, that same resolver shows Clocked Out, 7h 42m-class duration, and Corrected.

Staff history (`loadRecentCompletedShifts`) only includes completed in/out pairs, so it will show the corrected completed shift, not a 50h open duration.

Owner Reports tab remains a placeholder (“Coming later”). There is no second live duration calculator on that tab.

Payroll import pairing uses the same effective-event resolution and does not invent clock-outs.

## K. Payroll impact

EduClock duration **does** feed payroll pairing **when a complete in/out pair exists**.

Unchanged policy, with a safety confirmation:

- Unresolved missing clock-out → warning `MISSING_CLOCK_OUT`, **0 payable minutes** (no 26h/50h pair is invented).
- Staff cannot clock out a stale previous-day open shift with server-now (that would have created a payable multi-day pair).
- Owner same-day correction produces a normal pair (e.g. 7h 42m).
- No unrelated overtime / payroll-run policy was changed.

## L. Tests

Added:

- `backend/src/services/educlockAttendanceDuration.test.ts` — Case A/B, EMPTEST01, live same-day duration, date surfacing.
- `backend/src/routes/educlock.corrections.route.test.ts` — full owner workflow, audit, exception resolution, 401/403/404, clock-out before clock-in, wrong date, repeat 409, duplicate-clock independence, live open shift.
- `frontend/src/educlock/educlockCorrectionUi.test.ts` — Correct opens shared dialog, duration —, Exceptions CTA, duplicate informational.
- Payroll pairing assertion: historical missing clock-out is not payable.

Results:

| Suite | Result |
|---|---|
| Duration unit tests | PASS |
| Correction route tests (local `educlear` DB, synthetic fixtures only) | PASS |
| Payroll pairing + correction resolution unit tests | PASS |
| GPS distance unit tests | PASS |
| Frontend correction UI + existing EduClock UI unit tests | PASS |
| Existing Build 3 route test staff clock-in | FAIL **pre-existing**: `NO_ACTIVE_BOUNDARY` (Build 3 fixtures create an entrance, not a campus polygon). Not caused by this change; owner correction path does not use GPS. |

## M. Builds

| Build | Result |
|---|---|
| Backend TypeScript (`tsc`) | PASS |
| Backend `npm run build` | PASS |
| Frontend TypeScript (`tsc -b`) | PASS |
| Frontend production build (`npm run build`) | PASS |

## N. Exact files changed

Modified:

- `backend/src/routes/educlock.ts`
- `backend/src/services/educlockClockService.ts`
- `backend/src/services/payrollEduClockPairing.test.ts`
- `frontend/src/educlock/EduClockAttendanceTab.tsx`
- `frontend/src/educlock/EduClockExceptionsTab.tsx`
- `frontend/src/educlock/EduClockStaffClockPage.tsx`

Added:

- `backend/src/services/educlockAttendanceDuration.ts`
- `backend/src/services/educlockAttendanceDuration.test.ts`
- `backend/src/routes/educlock.corrections.route.test.ts`
- `frontend/src/educlock/EduClockCorrectionDialog.tsx`
- `frontend/src/educlock/educlockCorrectionUi.ts`
- `frontend/src/educlock/educlockCorrectionUi.test.ts`
- `docs/educlock-attendance-correction-fix-report.md` (this file)

## O. Production read-only findings

Not used. The 50h durations and dead Correct button are fully explained from current `origin/main` code. No production attendance rows were read or mutated.

## P. Remaining risks

- Overnight shifts are still **same school-local calendar date**. A 23:00 clock-in can only be corrected to a clock-out on that same date (e.g. 23:59). That matches the current attendance-day cutoff (end of school-local day, no auto clock-out).
- Existing production missing-clock-out rows stay open until an Owner corrects them in the UI after release. Display will show **—** immediately after deploy; history is not auto-rewritten.
- Duplicate Clock Attempt remains informational. No automatic cleanup.
- Build 3 GPS fixture test is already incompatible with campus-boundary GPS rules; GPS staff clocking was not changed except blocking stale previous-day clock-out.
- Correction times are interpreted as Africa/Johannesburg (`+02:00`), not the browser timezone.

## Q. Release recommendation

Controlled EduClock-only backend+frontend pair, after separate approval.

Do **not** merge to main or deploy from this chat. After release, Owners can correct genuine missing clock-outs in Attendance or Exceptions. Do not run DB scripts against live attendance.

---

NO PRODUCTION ATTENDANCE RECORDS MODIFIED

NO DIRECT PRODUCTION DB CORRECTIONS

NO PRISMA DB PUSH

NO MIGRATION CENTER CHANGES

NO MAIN MERGE

NO DEPLOYMENT

AWAITING SEPARATE RELEASE APPROVAL
