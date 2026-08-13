# EduClock attendance correction — time input validation fix

## A. Verdict

**READY TO REDEPLOY EDUCLOCK CORRECTION INPUT FIX**

The previous production release (`e08cb75`) remains **not fully passed**. The modal opens, but Save correction was blocked by a frontend time-input bug. That bug is fixed in this phase. Backend validation was not weakened. No production attendance was written.

This session did **not** commit, push, merge, or deploy. A separate authorised paired backend/frontend redeploy is required before any real correction (including Jemmah Harris · EMP0058).

| Item | Value |
|---|---|
| Base (current production) | `e08cb75c2d80babb7dafab2ebc7ba8d4bfd67582` on `release/educlock-attendance-corrections` |
| Fix branch | `fix/educlock-correction-time-input` (from `e08cb75`, uncommitted working tree) |
| Worktree | `/private/tmp/educlear-educlock-correction-release` |
| Production backend | `dep-d9uo142jobas73bagog0` — **unchanged** |
| Production frontend | `dep-d9uo14fqj5pc73834isg` — **unchanged** |

## B. Exact reproduction

Production (authenticated Owner, Safari):

| Field | Value |
|---|---|
| Employee | Jemmah Harris · EMP0058 |
| Attendance date | 2026-08-12 |
| Clock In | 07:18 |
| Clock Out | Missing |
| Status | Missing Clock Out |
| Selected time (Safari display) | 04:00 PM |
| Reason | Forgot to clock out |
| Action | Save correction |
| Result | UI error **Enter the correct clock-out time.** |
| Saved? | No. No correction event was created. |

The same production source (SHA `e08cb75`) was reproduced locally:

```ts
// EduClockCorrectionDialog.tsx at e08cb75
const [corrTime, setCorrTime] = useState("");
<input type="time" value={corrTime} onChange={(e) => setCorrTime(e.target.value)} />
async function submit() {
  if (!corrTime) {
    setError("Enter the correct clock-out time.");
    return;
  }
  // payload used schoolLocalTime: corrTime
}
```

Proof that this matches the symptom:

1. The error string is **only** emitted when the submit handler treats the time as empty (`if (!corrTime)`).
2. The control is a **controlled** `<input type="time" value={corrTime}>` initialised to `""`.
3. Safari’s 12-hour picker can **display** `04:00 PM` while React state remains `""`.
4. Submit never read the live HTML `input.value`; it trusted React state only.
5. Therefore a visually filled field still failed validation, and no request was sent.

Local contract test of that gap:

- `readCanonicalTimeFromInput({ value: "16:00" }, "") === "16:00"` — DOM had a valid time.
- Production submit used only the second argument (`""`) → error.
- Locale string `"04:00 PM"` is **not** a valid HTML time value and is rejected (not parsed).

No live Safari session was driven in this phase. Reproduction is from production source + the WHATWG/Safari `type="time"` value contract.

## C. Root cause

**Frontend only. Not backend. Not schema. Not timezone math.**

Two interacting defects:

1. **Controlled empty value.** `value={corrTime}` with `corrTime === ""` lets React own the DOM value. Safari’s time picker UI (especially 12-hour / AM/PM) can show a selected time in its presentation layer without a reliable React `onChange` update. WebKit commonly fires `change` on blur; Save is a `type="button"` click that can run **before** React state updates.
2. **Submit validated React state, not the HTML value.** `if (!corrTime)` ignored `timeRef.current.value`. The HTML contract for `type="time"` is 24-hour `HH:mm` (`16:00` for 4:00 PM), never the locale string `04:00 PM`.

Not the cause:

- Backend `parseOwnerCorrectionOccurredAt` (still requires `YYYY-MM-DD` + `HH:mm` / `HH:mm:ss`).
- Date combination (`2026-08-12` + `16:00` + `Africa/Johannesburg` / `+02:00`).
- Payload shape / `CLOSE_OPEN_SHIFT` action.
- `defaultValue` was unused; `onInput` was unused.

## D. Browser / Safari behaviour

WHATWG: `<input type="time">`.value is `""` or a valid **24-hour** time (`HH:mm`, `HH:mm:ss`, optional fraction). The visible 12-hour string is presentation only.

Safari-compatible mapping used in tests (HTML **value**, not parsed display text):

| Safari display (note only) | HTML `.value` | Canonical app value |
|---|---|---|
| 04:00 PM | `16:00` | `16:00` |
| 03:30 PM | `15:30` | `15:30` |
| 07:00 AM | `07:00` | `07:00` |
| 12:00 PM | `12:00` | `12:00` |
| 12:00 AM | `00:00` | `00:00` |

`canonicalizeHtmlTimeValue("04:00 PM")` returns `null`. The app must not parse AM/PM display strings.

## E. Value flow

For selected **4:00 PM** on **2026-08-12** in **Africa/Johannesburg**:

```
Safari display          04:00 PM
        ↓  (HTML contract, not string parse)
input.value             "16:00"
        ↓  readCanonicalTimeFromInput(dom, reactState)
React/app state         "16:00"
        ↓  frontend resolveCorrectionClockOutTime
Frontend validation     PASS
        ↓  POST /api/educlock/owner/corrections
Payload                 schoolLocalDate: "2026-08-12"
                        schoolLocalTime: "16:00"
                        action: CLOSE_OPEN_SHIFT
        ↓  parseOwnerCorrectionOccurredAt
Timestamp               2026-08-12T16:00:00+02:00
        ↓  ownerCreateCorrection
Correction service      append-only CLOCK_OUT, original IN preserved
Duration                07:18 → 16:00 = 8h 42m
```

If both DOM and React state are empty → frontend still shows **Enter the correct clock-out time.** and does not submit.

## F. Fix

Smallest safe frontend fix:

1. Time field is **uncontrolled** (`defaultValue=""`) so React’s empty string cannot wipe Safari’s native value.
2. `onChange`, `onInput`, and `onBlur` all capture `el.value` through `canonicalizeHtmlTimeValue` (HH:mm only).
3. Submit reads **live DOM first**, then React state: `readCanonicalTimeFromInput(timeRef.current, corrTime)`.
4. Payload `schoolLocalTime` is the canonical `HH:mm` string, never a locale display string.
5. State resets when employee id + affected date change (`correctionTimeInputResetKey`); the input remounts via `key`.

Backend correction parser, reasons, append-only events, payroll pairing, GPS/geofence, and schema were **not** changed.

## G. Validation retained

| Case | Result |
|---|---|
| Blank clock-out | Frontend reject + backend 400 |
| Locale `04:00 PM` string in payload | Frontend reject + backend 400 |
| Malformed `16` | Frontend reject + backend 400 |
| Impossible `25:61` | Backend 400 |
| Clock-out before clock-in (`07:00` vs `07:18`) | Backend 400 |
| Invalid date `12/08/2026` | Backend 400 |
| Wrong school employee | Backend 404 |
| Unauthenticated | 401 |
| Teacher / unauthorised role | 403 |
| Repeat correction | 409 |
| Valid `16:00` | Frontend PASS, backend 201 |

## H. Regression tests

Previous EduClock correction suite re-run, plus new input-contract / Jemmah synthetic cases.

| Suite | Result |
|---|---|
| `frontend/src/educlock/educlockCorrectionUi.test.ts` (modal, duration —, Safari contract, Jemmah payload `16:00`, blank/AM/PM reject, reset key) | PASS |
| `frontend/src/educlock/educlockOwnerUi.labels.test.ts` | PASS |
| `frontend/src/educlock/educlockGeofenceUi.test.ts` | PASS |
| `frontend/src/educlock/educlockStaffGeolocation.test.ts` | PASS |
| `frontend/src/educlock/educlockLocationPermissionHelp.test.ts` | PASS |
| `backend/src/services/educlockAttendanceDuration.test.ts` (historical `—`, live duration, EMPTEST01 7h 42m, **Jemmah 8h 42m**) | PASS |
| `backend/src/routes/educlock.corrections.route.test.ts` (modal-equivalent API: affected date, original preserved, append-only, 401/403/404, before-in, wrong date, blank/AM/PM/malformed/impossible/invalid date, EMPTEST01 15:00 / 7h 42m, **Jemmah synth 16:00 / 8h 42m**, Corrected, exception resolved, duplicate-clock unchanged, live open shift) | PASS |
| `backend/src/services/payrollEduClockPairing.test.ts` | PASS |
| `backend/src/services/payrollEduClockCorrectionResolution.test.ts` | PASS |
| `backend/src/utils/educlockGpsDistance.test.ts` | PASS |

Jemmah synthetic (local DB only, **not** production EMP0058):

- Date `2026-08-12`, clock-in `07:18`, selected HTML time `16:00`
- Frontend payload `schoolLocalTime: "16:00"`, `schoolLocalDate: "2026-08-12"`
- Backend 201, `durationDisplay: "8h 42m"`, original CLOCK_IN preserved

## I. Builds

| Build | Result |
|---|---|
| Backend `tsc --noEmit` | PASS |
| Backend `npm run build` | PASS |
| Frontend `tsc -b` | PASS |
| Frontend `npm run build` | PASS (`dist/assets/index-Cvi1tqUG.js`) |

## J. Exact files changed

```
frontend/src/educlock/EduClockCorrectionDialog.tsx
frontend/src/educlock/educlockCorrectionUi.ts
frontend/src/educlock/educlockCorrectionUi.test.ts
backend/src/routes/educlock.corrections.route.test.ts
backend/src/services/educlockAttendanceDuration.test.ts
docs/educlock-attendance-correction-input-fix-report.md
```

Not changed: Prisma schema, migrations, Migration Center, Phase 1Q / 1Q-A, payroll policy, GPS/geofence logic, `educlockClockService` validation, production attendance.

## K. Production writes

None.

- No correction POST against production.
- No scripted attendance update.
- No direct DB edit of Jemmah Harris / EMP0058 / any production clock event.
- Local route tests used throwaway schools on `postgresql://educlear@localhost/educlear` only.

## L. Redeploy recommendation

After this working tree is committed (separate instruction):

1. Layer the commit on `e08cb75` / production (`b39ad5f` + EduClock). Do **not** deploy `origin/main`.
2. Deploy **backend and frontend together**.
3. Record new SHAs and deploy ids.
4. Authenticated Safari smoke: open Correct for a missing clock-out, select 4:00 PM, confirm the field still shows the time, Save. Expect canonical `16:00` and a real append-only correction **only when that controlled write is separately authorised**.
5. Then, and only then, resume the Jemmah Harris · EMP0058 2026-08-12 correction (expected duration **8h 42m**).

Do not treat `e08cb75` as fully passed until this input fix is live and the controlled correction succeeds.

---

ZERO REAL ATTENDANCE CORRECTIONS PERFORMED

NO DIRECT PRODUCTION DB EDIT

NO PRISMA DB PUSH

NO SCHEMA CHANGE

NO MIGRATION CENTER CHANGE

NO DEPLOYMENT FROM THIS PHASE
