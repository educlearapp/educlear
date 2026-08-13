/**
 * EduClock owner correction UI helpers + source guards.
 * Run from frontend: npx --yes tsx src/educlock/educlockCorrectionUi.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  OWNER_CORRECTION_REASONS,
  SAFARI_TIME_INPUT_CONTRACT,
  buildOwnerCorrectionRequest,
  canonicalizeHtmlTimeValue,
  correctionActionForStatus,
  correctionNotesRequired,
  correctionTimeInputResetKey,
  displayAttendanceDuration,
  isActionableMissingClockOutException,
  isInformationalDuplicateClockException,
  isMissingClockOutStatus,
  readCanonicalTimeFromInput,
  resolveCorrectionClockOutTime,
  targetFromAttendanceRow,
  targetFromExceptionRow,
} from "./educlockCorrectionUi";

const EDUCLOCK_DIR = path.join(process.cwd(), "src/educlock");

function read(file: string): string {
  return fs.readFileSync(path.join(EDUCLOCK_DIR, file), "utf8");
}

assert.equal(
  displayAttendanceDuration({
    currentStatus: "Missing Clock Out",
    workedDuration: "50h 7m",
  }),
  "—"
);
assert.equal(
  displayAttendanceDuration({
    currentStatus: "Missing Clock Out",
    workedDuration: "50h 41m",
  }),
  "—"
);
assert.equal(
  displayAttendanceDuration({
    currentStatus: "Clocked In",
    workedDuration: "2h 16m",
  }),
  "2h 16m"
);
assert.equal(
  displayAttendanceDuration({
    currentStatus: "Clocked Out",
    workedDuration: "7h 42m",
  }),
  "7h 42m"
);

assert.equal(isMissingClockOutStatus("Missing Clock Out"), true);
assert.equal(correctionActionForStatus("Missing Clock Out"), "CLOSE_OPEN_SHIFT");
assert.equal(correctionNotesRequired("Other"), true);
assert.equal(correctionNotesRequired("Forgot to clock out"), false);
assert.ok(OWNER_CORRECTION_REASONS.includes("Forgot to clock out"));
assert.ok(OWNER_CORRECTION_REASONS.includes("Device problem"));
assert.ok(OWNER_CORRECTION_REASONS.includes("Network problem"));
assert.ok(OWNER_CORRECTION_REASONS.includes("Incorrect clock event"));
assert.ok(OWNER_CORRECTION_REASONS.includes("Admin correction"));
assert.ok(OWNER_CORRECTION_REASONS.includes("Other"));

assert.equal(
  isActionableMissingClockOutException({
    exceptionType: "MISSING_CLOCK_OUT",
    status: "OPEN",
  }),
  true
);
assert.equal(
  isActionableMissingClockOutException({
    exceptionType: "DUPLICATE_CLOCK_ATTEMPT",
    status: "OPEN",
  }),
  false
);
assert.equal(
  isInformationalDuplicateClockException({ exceptionType: "DUPLICATE_CLOCK_ATTEMPT" }),
  true
);

const attTarget = targetFromAttendanceRow(
  {
    employeeId: "e1",
    employeeName: "Test Emp",
    employeeNumber: "EMPTEST01",
    affectedSchoolLocalDate: "2026-08-12",
    clockInTime: "07:18",
    clockOutTime: null,
    currentStatus: "Missing Clock Out",
  },
  "2026-08-13"
);
assert.equal(attTarget.affectedSchoolLocalDate, "2026-08-12");
assert.equal(attTarget.clockInTime, "07:18");
assert.equal(attTarget.employeeNumber, "EMPTEST01");

const exTarget = targetFromExceptionRow({
  employeeId: "e1",
  employeeName: "Test Emp",
  employeeNumber: "EMPTEST01",
  schoolLocalDate: "2026-08-12",
  clockInTime: "07:18",
  exceptionType: "MISSING_CLOCK_OUT",
  relatedEventId: "evt1",
});
assert.equal(exTarget.currentStatus, "Missing Clock Out");
assert.equal(exTarget.affectedSchoolLocalDate, "2026-08-12");

// Safari 12-hour display vs HTML time value contract. Canonicalise .value, never "04:00 PM".
for (const c of SAFARI_TIME_INPUT_CONTRACT) {
  assert.equal(canonicalizeHtmlTimeValue(c.htmlValue), c.canonical, c.safariDisplayNote);
  assert.equal(
    canonicalizeHtmlTimeValue(c.safariDisplayNote),
    null,
    `must not parse locale display ${c.safariDisplayNote}`
  );
}
assert.equal(canonicalizeHtmlTimeValue("16:00:00"), "16:00");
assert.equal(canonicalizeHtmlTimeValue(""), null);
assert.equal(canonicalizeHtmlTimeValue("25:00"), null);
assert.equal(canonicalizeHtmlTimeValue("4:00"), null);
assert.equal(canonicalizeHtmlTimeValue("16:00 PM"), null);

// Production bug: Safari showed 04:00 PM while React state stayed "".
assert.equal(readCanonicalTimeFromInput({ value: "" }, ""), null);
assert.equal(readCanonicalTimeFromInput({ value: "16:00" }, ""), "16:00");
assert.equal(readCanonicalTimeFromInput({ value: "" }, "16:00"), "16:00");
assert.equal(readCanonicalTimeFromInput({ value: "16:00" }, "07:00"), "16:00");

const safariEmptyState = resolveCorrectionClockOutTime({
  htmlInputValue: "16:00",
  reactStateValue: "",
});
assert.equal(safariEmptyState.ok, true);
if (safariEmptyState.ok) assert.equal(safariEmptyState.schoolLocalTime, "16:00");

const blankTime = resolveCorrectionClockOutTime({ htmlInputValue: "", reactStateValue: "" });
assert.equal(blankTime.ok, false);
if (!blankTime.ok) assert.equal(blankTime.error, "Enter the correct clock-out time.");

const localeLeak = resolveCorrectionClockOutTime({
  htmlInputValue: "04:00 PM",
  reactStateValue: "04:00 PM",
});
assert.equal(localeLeak.ok, false);

const jemmahTarget = targetFromAttendanceRow(
  {
    employeeId: "emp-jemmah-synth",
    employeeName: "Jemmah Harris",
    employeeNumber: "EMP0058",
    affectedSchoolLocalDate: "2026-08-12",
    clockInTime: "07:18",
    clockOutTime: null,
    currentStatus: "Missing Clock Out",
    clockInEventId: "evt-jemmah-in",
  },
  "2026-08-13"
);
const jemmah = buildOwnerCorrectionRequest({
  target: jemmahTarget,
  reason: "Forgot to clock out",
  htmlInputValue: "16:00",
  reactStateValue: "",
});
assert.equal(jemmah.ok, true);
if (jemmah.ok) {
  assert.equal(jemmah.payload.schoolLocalDate, "2026-08-12");
  assert.equal(jemmah.payload.schoolLocalTime, "16:00");
  assert.equal(jemmah.payload.action, "CLOSE_OPEN_SHIFT");
  assert.equal(jemmah.payload.employeeId, "emp-jemmah-synth");
  assert.equal(jemmah.payload.targetEventId, "evt-jemmah-in");
}

const otherEmployeeKey = correctionTimeInputResetKey({
  employeeId: "emp-other",
  affectedSchoolLocalDate: "2026-08-12",
});
assert.notEqual(correctionTimeInputResetKey(jemmahTarget), otherEmployeeKey);

const attSrc = read("EduClockAttendanceTab.tsx");
assert.ok(attSrc.includes("EduClockCorrectionDialog"), "attendance uses shared dialog");
assert.ok(attSrc.includes("setCorrectTarget"), "Correct button opens workflow");
assert.ok(attSrc.includes("displayAttendanceDuration"), "duration helper used");
assert.ok(attSrc.includes("Corrected"), "correction indicator visible");
assert.ok(!attSrc.includes("marginTop: 16,\n            padding: 16,\n            border: \"1px solid #e5e7eb\",\n            borderRadius: 10"), "old below-table panel removed");

const dlgSrc = read("EduClockCorrectionDialog.tsx");
assert.ok(dlgSrc.includes('role="dialog"'), "dialog role");
assert.ok(dlgSrc.includes('aria-modal="true"'), "modal");
assert.ok(dlgSrc.includes("position: \"fixed\""), "overlay is fixed");
assert.ok(dlgSrc.includes("Correct Clock Out time"), "clock-out field");
assert.ok(dlgSrc.includes("Attendance date"), "shows affected date");
assert.ok(dlgSrc.includes("postOwnerEduClockCorrection"), "shared backend API");
assert.ok(!dlgSrc.includes("ADD_CLOCK_IN"), "missing clock-out does not require re-entering clock-in");
assert.ok(dlgSrc.includes("readCanonicalTimeFromInput"), "submit reads live HTML time value");
assert.ok(dlgSrc.includes("onInput"), "Safari time picker input event");
assert.ok(dlgSrc.includes("onBlur"), "Safari time picker commit on blur");
assert.ok(dlgSrc.includes("defaultValue"), "uncontrolled time input so React empty state cannot wipe Safari value");
assert.ok(!dlgSrc.includes("value={corrTime}"), "must not keep a controlled empty time value");
assert.ok(dlgSrc.includes("correctionTimeInputResetKey"), "time state resets per employee/date");

const exSrc = read("EduClockExceptionsTab.tsx");
assert.ok(exSrc.includes("EduClockCorrectionDialog"), "exceptions share the same dialog");
assert.ok(exSrc.includes("Correct Attendance"), "actionable missing clock-out CTA");
assert.ok(exSrc.includes("isActionableMissingClockOutException"), "only missing clock-out is actionable");
assert.ok(exSrc.includes("isInformationalDuplicateClockException"), "duplicate attempts stay informational");
assert.ok(exSrc.includes("Informational"), "duplicate attempts are not corrected here");

const staffSrc = read("EduClockStaffClockPage.tsx");
assert.ok(staffSrc.includes("missingClockOut"), "staff page distinguishes stale missing clock-out");
assert.ok(staffSrc.includes("correct attendance"), "staff cannot self-correct via owner endpoint");

console.log("EDUCLOCK CORRECTION UI TESTS PASS");
