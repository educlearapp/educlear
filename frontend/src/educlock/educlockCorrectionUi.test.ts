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
  canOfferAttendanceCorrection,
  correctionActionForStatus,
  correctionFieldsForStatus,
  correctionNotesRequired,
  correctionTimeInputResetKey,
  defaultCorrectionReason,
  displayAttendanceDuration,
  durationBetweenHm,
  isActionableMissingClockOutException,
  isClockOutBeforeClockIn,
  isInformationalDuplicateClockException,
  isMissingClockInStatus,
  isMissingClockOutStatus,
  isNotClockedInStatus,
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
assert.equal(isMissingClockInStatus("Missing Clock In"), true);
assert.equal(isNotClockedInStatus("Not Clocked In"), true);
assert.equal(correctionActionForStatus("Missing Clock Out"), "CLOSE_OPEN_SHIFT");
assert.equal(correctionActionForStatus("Missing Clock In"), "ADD_CLOCK_IN");
assert.equal(correctionActionForStatus("Not Clocked In"), "ADD_CLOCK_IN");
assert.deepEqual(correctionFieldsForStatus("Missing Clock Out"), { clockIn: false, clockOut: true });
assert.deepEqual(correctionFieldsForStatus("Missing Clock In"), { clockIn: true, clockOut: false });
assert.deepEqual(correctionFieldsForStatus("Not Clocked In"), { clockIn: true, clockOut: true });
assert.deepEqual(correctionFieldsForStatus("Clocked Out"), { clockIn: false, clockOut: false });
assert.equal(canOfferAttendanceCorrection("Clocked Out"), false);
assert.equal(canOfferAttendanceCorrection("Missing Clock In"), true);
assert.equal(defaultCorrectionReason("Missing Clock Out"), "Forgot to clock out");
assert.equal(defaultCorrectionReason("Missing Clock In"), "Forgot to clock in");
assert.equal(correctionNotesRequired("Other"), true);
assert.equal(correctionNotesRequired("Forgot to clock out"), false);
assert.ok(OWNER_CORRECTION_REASONS.includes("Forgot to clock in"));
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
assert.equal(durationBetweenHm("06:35", "15:02"), "8h 27m");
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

// Case B — selected 12 Aug row must not be rewritten to a following-day event date.
const micaelaTarget = targetFromAttendanceRow(
  {
    employeeId: "emp-micaela-synth",
    employeeName: "Micaela Lee Erasmus",
    employeeNumber: "EMP0020SYN",
    affectedSchoolLocalDate: "2026-08-12",
    clockInTime: "06:35",
    clockOutTime: null,
    currentStatus: "Missing Clock Out",
    clockInEventId: "evt-micaela-12-in",
  },
  "2026-08-13"
);
assert.equal(micaelaTarget.affectedSchoolLocalDate, "2026-08-12");
const micaela = buildOwnerCorrectionRequest({
  target: micaelaTarget,
  reason: "Forgot to clock out",
  hour: "03",
  minute: "02",
  meridiem: "PM",
});
assert.equal(micaela.ok, true);
if (micaela.ok) {
  assert.equal(micaela.payload.schoolLocalDate, "2026-08-12");
  assert.equal(micaela.payload.schoolLocalTime, "15:02");
  assert.equal(micaela.payload.action, "CLOSE_OPEN_SHIFT");
  assert.equal(micaela.payload.targetEventId, "evt-micaela-12-in");
}

// Case C / Zahne-like — missing clock-in uses the same explicit selector.
const zahneTarget = targetFromAttendanceRow(
  {
    employeeId: "emp-zahne-synth",
    employeeName: "Zahne Klopper",
    employeeNumber: "EMP0045SYN",
    affectedSchoolLocalDate: "2026-08-12",
    clockInTime: null,
    clockOutTime: "15:02",
    currentStatus: "Missing Clock In",
  },
  "2026-08-12"
);
assert.equal(zahneTarget.clockInTime, null);
assert.equal(correctionFieldsForStatus(zahneTarget.currentStatus).clockIn, true);
assert.equal(correctionFieldsForStatus(zahneTarget.currentStatus).clockOut, false);
const zahne = buildOwnerCorrectionRequest({
  target: zahneTarget,
  reason: "Forgot to clock in",
  clockInHour: "06",
  clockInMinute: "35",
  clockInMeridiem: "AM",
});
assert.equal(zahne.ok, true);
if (zahne.ok) {
  assert.equal(zahne.payload.schoolLocalDate, "2026-08-12");
  assert.equal(zahne.payload.schoolLocalTime, "06:35");
  assert.equal(zahne.payload.action, "ADD_CLOCK_IN");
  assert.equal(zahne.payload.schoolLocalClockOutTime, null);
}
const zahneAfterOut = buildOwnerCorrectionRequest({
  target: zahneTarget,
  reason: "Forgot to clock in",
  clockInHour: "04",
  clockInMinute: "00",
  clockInMeridiem: "PM",
});
assert.equal(zahneAfterOut.ok, false);

const bothMissing = buildOwnerCorrectionRequest({
  target: targetFromAttendanceRow(
    {
      employeeId: "emp-both",
      employeeName: "Both Missing",
      affectedSchoolLocalDate: "2026-08-12",
      clockInTime: null,
      clockOutTime: null,
      currentStatus: "Not Clocked In",
    },
    "2026-08-12"
  ),
  reason: "Forgot to clock in",
  clockInHour: "07",
  clockInMinute: "00",
  clockInMeridiem: "AM",
});
assert.equal(bothMissing.ok, false, "both-missing requires clock-out as well as clock-in");

const bothEntered = buildOwnerCorrectionRequest({
  target: targetFromAttendanceRow(
    {
      employeeId: "emp-both",
      employeeName: "Both Missing",
      affectedSchoolLocalDate: "2026-08-12",
      clockInTime: null,
      clockOutTime: null,
      currentStatus: "Not Clocked In",
    },
    "2026-08-12"
  ),
  reason: "Forgot to clock in",
  clockInHour: "07",
  clockInMinute: "00",
  clockInMeridiem: "AM",
  clockOutHour: "04",
  clockOutMinute: "00",
  clockOutMeridiem: "PM",
});
assert.equal(bothEntered.ok, true);
if (bothEntered.ok) {
  assert.equal(bothEntered.payload.schoolLocalTime, "07:00");
  assert.equal(bothEntered.payload.schoolLocalClockOutTime, "16:00");
  assert.equal(bothEntered.payload.action, "ADD_CLOCK_IN");
}

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
assert.ok(dlgSrc.includes("Correct Clock In time"), "clock-in field");
assert.ok(dlgSrc.includes("Attendance date"), "shows affected date");
assert.ok(dlgSrc.includes("postOwnerEduClockCorrection"), "shared backend API");
assert.ok(dlgSrc.includes("correctionFieldsForStatus"), "dialog adapts to missing in vs out");
assert.ok(dlgSrc.includes("buildOwnerCorrectionRequest"), "submit uses shared request builder");
assert.ok(!dlgSrc.includes('type="time"'), "must not use Safari-fragile native time input");
assert.ok(dlgSrc.includes('aria-label="Hour"') || dlgSrc.includes('hourLabel'), "explicit hour select");
assert.ok(dlgSrc.includes('aria-label="Minute"') || dlgSrc.includes('minuteLabel'), "explicit minute select");
assert.ok(dlgSrc.includes('aria-label="AM/PM"') || dlgSrc.includes('meridiemLabel'), "explicit AM/PM select");
assert.ok(dlgSrc.includes("canonicalizeTwelveHourClockParts"), "submit uses explicit 12-hour parts");
assert.ok(dlgSrc.includes("Will save as"), "selected time is shown as canonical HH:mm");
assert.ok(dlgSrc.includes("correctionTimeInputResetKey"), "time state resets per employee/date");

const uiSrc = read("educlockCorrectionUi.ts");
assert.ok(uiSrc.includes("isClockOutBeforeClockIn"), "frontend rejects clock-out before clock-in");
assert.ok(uiSrc.includes("isClockInAfterClockOut"), "frontend rejects clock-in after clock-out");
assert.ok(attSrc.includes("MISSING_CLOCK_IN"), "attendance filter includes missing clock-in");
assert.ok(attSrc.includes("canOfferAttendanceCorrection"), "Correct only for missing-event rows");

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
