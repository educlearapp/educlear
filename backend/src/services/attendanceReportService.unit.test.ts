/**
 * Pure unit checks for learner attendance report helpers (no DB).
 * Run: npx ts-node --transpile-only src/services/attendanceReportService.unit.test.ts
 */
import {
  addDaysYmd,
  computeLearnerDayTotals,
  describeSchoolDate,
  friendlyCapturedByDisplay,
  listSchoolDaysInRange,
  statusAbbrev,
  toFriendlyAttendanceStatus,
} from "./attendanceReportService";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Daily weekday + full date
const tue = describeSchoolDate("2026-07-21");
assert(tue.weekday === "Tuesday", `weekday expected Tuesday got ${tue.weekday}`);
assert(tue.fullDateLabel === "Tuesday, 21 Jul 2026", `full date ${tue.fullDateLabel}`);
assert(tue.headingWeekly === "Tue 21 Jul", `weekly heading ${tue.headingWeekly}`);
assert(tue.headingMonthly === "21 Tue", `monthly heading ${tue.headingMonthly}`);

// Mon-Fri filtering
const weekdays = listSchoolDaysInRange("2026-07-20", "2026-07-26", false);
assert(
  weekdays.join(",") === "2026-07-20,2026-07-21,2026-07-22,2026-07-23,2026-07-24",
  `weekdays ${weekdays.join(",")}`
);

// Weekend inclusion
const withWeekends = listSchoolDaysInRange("2026-07-20", "2026-07-26", true);
assert(withWeekends.length === 7, `weekend week length ${withWeekends.length}`);
assert(withWeekends.includes("2026-07-25") && withWeekends.includes("2026-07-26"), "weekend days missing");

// Friendly labels — no enum leak
for (const [raw, expected] of [
  ["PRESENT", "Present"],
  ["ABSENT", "Absent"],
  ["LATE", "Late"],
  ["EXCUSED", "Excused"],
  ["NOT_CAPTURED", "Not Captured"],
  ["", "Not Captured"],
] as const) {
  const label = toFriendlyAttendanceStatus(raw);
  assert(label === expected, `label ${raw} -> ${label}`);
  assert(!label.includes("_"), `underscore leaked for ${raw}`);
  assert(String(label) !== "PRESENT" && String(label) !== "ABSENT", `enum leaked for ${raw}`);
}

assert(statusAbbrev("PRESENT") === "P", "P");
assert(statusAbbrev("ABSENT") === "A", "A");
assert(statusAbbrev("LATE") === "L", "L");
assert(statusAbbrev("EXCUSED") === "E", "E");
assert(statusAbbrev("NOT_CAPTURED") === "N", "N");

// Attendance % and capture completion
const totals = computeLearnerDayTotals(
  ["PRESENT", "LATE", "ABSENT", "EXCUSED", "NOT_CAPTURED"],
  5
);
assert(totals.attended === 2, `attended ${totals.attended}`);
assert(totals.captured === 4, `captured ${totals.captured}`);
assert(totals.present === 1 && totals.late === 1 && totals.absent === 1 && totals.excused === 1, "counts");
assert(totals.notCaptured === 1, "notCaptured");
assert(totals.attendancePercentage === 40, `attendance % ${totals.attendancePercentage}`);
assert(totals.captureCompletionPercentage === 80, `capture % ${totals.captureCompletionPercentage}`);

// Not Captured never counts as present/absent in %
const onlyMissing = computeLearnerDayTotals(["NOT_CAPTURED", "NOT_CAPTURED"], 2);
assert(onlyMissing.attendancePercentage === 0, "missing must not count attended");
assert(onlyMissing.captureCompletionPercentage === 0, "missing must not count captured");

// Captured-by fallback — no raw cuid
assert(friendlyCapturedByDisplay("clxyzabcdefghijklmnopqrstu", null) === "Recorded User", "cuid");
assert(friendlyCapturedByDisplay("", null) === "Recorded User", "empty");
assert(friendlyCapturedByDisplay("jane.doe@school.test", null) === "Jane Doe", "email pretty");
assert(friendlyCapturedByDisplay("x", "Mrs Smith") === "Mrs Smith", "resolved");

// Timezone-safe noon date arithmetic
assert(addDaysYmd("2026-07-21", 1) === "2026-07-22", "add day");
assert(addDaysYmd("2026-12-31", 1) === "2027-01-01", "year boundary");

console.log("attendanceReportService.unit.test.ts: PASS");
