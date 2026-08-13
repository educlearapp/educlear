/**
 * EduClock owner correction UI helpers + source guards.
 * Run from frontend: npx --yes tsx src/educlock/educlockCorrectionUi.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  OWNER_CORRECTION_REASONS,
  buildOwnerCorrectionRequest,
  canonicalizeHtmlTimeValue,
  canonicalizeTwelveHourClockParts,
  correctionActionForStatus,
  correctionNotesRequired,
  correctionTimeInputResetKey,
  displayAttendanceDuration,
  durationBetweenHm,
  isActionableMissingClockOutException,
  isClockOutBeforeClockIn,
  isInformationalDuplicateClockException,
  isMissingClockOutStatus,
  readCanonicalTimeFromInput,
  resolveCorrectionClockOutTime,
  targetFromAttendanceRow,
  targetFromExceptionRow,
  webkitTimeInputCanDisplayWithoutValue,
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

// Actual Safari/WebKit failure at production SHA 3779181:
// Owner saw 04:00 PM, HTMLInputElement.value stayed "", React state stayed "".
assert.equal(
  webkitTimeInputCanDisplayWithoutValue({
    displayedText: "04:00 PM",
    htmlValue: "",
    reactState: "",
  }),
  true,
  "WebKit can paint a time while .value and React state remain empty"
);
assert.equal(readCanonicalTimeFromInput({ value: "" }, ""), null);
assert.equal(canonicalizeHtmlTimeValue("04:00 PM"), null, "locale display string is not HTML time value");
assert.equal(
  resolveCorrectionClockOutTime({ hour: "", minute: "", meridiem: "" }).ok,
  false,
  "blank explicit parts still reject"
);

// Replacement control: explicit Hour + Minute + AM/PM owns application state.
assert.equal(canonicalizeTwelveHourClockParts({ hour: "04", minute: "00", meridiem: "PM" }), "16:00");
assert.equal(canonicalizeTwelveHourClockParts({ hour: "03", minute: "30", meridiem: "PM" }), "15:30");
assert.equal(canonicalizeTwelveHourClockParts({ hour: "07", minute: "00", meridiem: "AM" }), "07:00");
assert.equal(canonicalizeTwelveHourClockParts({ hour: "12", minute: "00", meridiem: "PM" }), "12:00");
assert.equal(canonicalizeTwelveHourClockParts({ hour: "12", minute: "00", meridiem: "AM" }), "00:00");
assert.equal(canonicalizeTwelveHourClockParts({ hour: "01", minute: "05", meridiem: "PM" }), "13:05");
assert.equal(canonicalizeTwelveHourClockParts({ hour: "4", minute: "00", meridiem: "PM" }), "16:00");
assert.equal(canonicalizeTwelveHourClockParts({ hour: "", minute: "00", meridiem: "PM" }), null);
assert.equal(canonicalizeTwelveHourClockParts({ hour: "13", minute: "00", meridiem: "PM" }), null);
assert.equal(canonicalizeTwelveHourClockParts({ hour: "04", minute: "60", meridiem: "PM" }), null);
assert.equal(canonicalizeTwelveHourClockParts({ hour: "04", minute: "00", meridiem: "XX" }), null);

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
  hour: "04",
  minute: "00",
  meridiem: "PM",
});
assert.equal(jemmah.ok, true);
if (jemmah.ok) {
  assert.equal(jemmah.payload.schoolLocalDate, "2026-08-12");
  assert.equal(jemmah.payload.schoolLocalTime, "16:00");
  assert.equal(jemmah.payload.action, "CLOSE_OPEN_SHIFT");
  assert.equal(jemmah.payload.employeeId, "emp-jemmah-synth");
  assert.equal(jemmah.payload.targetEventId, "evt-jemmah-in");
}
assert.equal(durationBetweenHm("07:18", "16:00"), "8h 42m");
assert.equal(isClockOutBeforeClockIn("07:18", "07:00"), true);
assert.equal(isClockOutBeforeClockIn("07:18", "16:00"), false);

const beforeIn = buildOwnerCorrectionRequest({
  target: jemmahTarget,
  reason: "Forgot to clock out",
  hour: "07",
  minute: "00",
  meridiem: "AM",
});
assert.equal(beforeIn.ok, false);

const blankParts = buildOwnerCorrectionRequest({
  target: jemmahTarget,
  reason: "Forgot to clock out",
  hour: "",
  minute: "",
  meridiem: "",
});
assert.equal(blankParts.ok, false);
if (!blankParts.ok) assert.equal(blankParts.error, "Enter the correct clock-out time.");

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
assert.ok(!dlgSrc.includes('type="time"'), "must not use Safari-fragile native time input");
assert.ok(dlgSrc.includes('aria-label="Hour"'), "explicit hour select");
assert.ok(dlgSrc.includes('aria-label="Minute"'), "explicit minute select");
assert.ok(dlgSrc.includes('aria-label="AM/PM"'), "explicit AM/PM select");
assert.ok(dlgSrc.includes("canonicalizeTwelveHourClockParts"), "submit uses explicit 12-hour parts");
assert.ok(dlgSrc.includes("Will save as"), "selected time is shown as canonical HH:mm");
assert.ok(dlgSrc.includes("correctionTimeInputResetKey"), "time state resets per employee/date");
assert.ok(dlgSrc.includes("isClockOutBeforeClockIn"), "frontend rejects clock-out before clock-in");

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
