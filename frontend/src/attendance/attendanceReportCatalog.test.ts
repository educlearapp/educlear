/**
 * Frontend attendance register helpers (no DOM / no API).
 * Run: npx --yes tsx src/attendance/attendanceReportCatalog.test.ts
 */
import assert from "node:assert/strict";
import {
  fridayOfWeek,
  friendlyAttendanceStatus,
  getAttendanceCatalogConfig,
  isLearnerAttendanceRegister,
  mondayOfWeek,
  monthBounds,
  resolveAttendanceReportRange,
  sundayOfWeek,
} from "./attendanceReportCatalog";
import { buildAttendanceReportCsv } from "./buildAttendanceReportCsv";
import type { AttendanceReportPayload } from "./attendanceReportCatalog";

assert.equal(isLearnerAttendanceRegister("Attendance Register (Daily)"), true);
assert.equal(isLearnerAttendanceRegister("Child List"), false);
assert.equal(isLearnerAttendanceRegister("Employee Attendance Register (Weekly)"), false);

assert.equal(getAttendanceCatalogConfig("Attendance Register (Weekly)")?.includeWeekends, false);
assert.equal(
  getAttendanceCatalogConfig("Attendance Register (Weekly) (Weekends)")?.includeWeekends,
  true
);

assert.equal(mondayOfWeek("2026-07-22"), "2026-07-20");
assert.equal(fridayOfWeek("2026-07-22"), "2026-07-24");
assert.equal(sundayOfWeek("2026-07-22"), "2026-07-26");
assert.deepEqual(monthBounds("2026-07-15"), { start: "2026-07-01", end: "2026-07-31" });

assert.deepEqual(resolveAttendanceReportRange("daily", "2026-07-21", false), {
  startDate: "2026-07-21",
  endDate: "2026-07-21",
});
assert.deepEqual(resolveAttendanceReportRange("weekly", "2026-07-21", false), {
  startDate: "2026-07-20",
  endDate: "2026-07-24",
});
assert.deepEqual(resolveAttendanceReportRange("weekly", "2026-07-21", true), {
  startDate: "2026-07-20",
  endDate: "2026-07-26",
});

assert.equal(friendlyAttendanceStatus("PRESENT"), "Present");
assert.equal(friendlyAttendanceStatus("ABSENT"), "Absent");
assert.equal(friendlyAttendanceStatus("LATE"), "Late");
assert.equal(friendlyAttendanceStatus("EXCUSED"), "Excused");
assert.equal(friendlyAttendanceStatus("NOT_CAPTURED"), "Not Captured");
assert.equal(friendlyAttendanceStatus(""), "Not Captured");
assert.ok(!friendlyAttendanceStatus("PRESENT").includes("_"));

const sample: AttendanceReportPayload = {
  meta: {
    schoolId: "s1",
    schoolName: "Test School",
    title: "Daily Attendance Register",
    startDate: "2026-07-21",
    endDate: "2026-07-21",
    period: "DAILY",
    periodLabel: "Daily",
    className: "Grade 3A",
    classroomScope: "SINGLE",
    includeWeekends: false,
    groupBy: "classrooms",
    timezone: "Africa/Johannesburg",
    generatedAt: "2026-07-22T06:00:00.000Z",
    generatedAtDisplay: "2026-07-22 08:00 (Africa/Johannesburg)",
    holidayLimitation: "Holidays are not currently configured",
  },
  dates: [
    {
      date: "2026-07-21",
      weekday: "Tuesday",
      weekdayShort: "Tue",
      dayOfMonth: 21,
      monthShort: "Jul",
      fullDateLabel: "Tuesday, 21 Jul 2026",
      headingWeekly: "Tue 21 Jul",
      headingMonthly: "21 Tue",
    },
  ],
  sections: [
    {
      key: "classroom:Grade 3A",
      label: "Grade 3A",
      type: "classroom",
      learners: [
        {
          learnerId: "l1",
          firstName: "Ann",
          lastName: "Bee",
          fullName: "Ann Bee",
          admissionNo: "ADM1",
          classroom: "Grade 3A",
          groupNames: [],
          days: {
            "2026-07-21": {
              date: "2026-07-21",
              status: "PRESENT",
              statusLabel: "Present",
              statusAbbrev: "P",
              reason: "ok",
              capturedBy: "Teacher",
              capturedAt: null,
              capturedAtDisplay: null,
            },
          },
          totals: {
            present: 1,
            absent: 0,
            late: 0,
            excused: 0,
            notCaptured: 0,
            attended: 1,
            captured: 1,
            expected: 1,
            attendancePercentage: 100,
            captureCompletionPercentage: 100,
          },
        },
      ],
    },
  ],
  learners: [],
  summary: { learnerCount: 1, expectedSchoolDays: 1, sectionCount: 1 },
  emptyState: null,
  groupsAvailable: false,
  groupByDisabledReason: null,
};

const csv = buildAttendanceReportCsv(sample, "daily", "Attendance Register (Daily)");
assert.ok(csv.includes("Tuesday, 21 Jul 2026"), "csv full date");
assert.ok(csv.includes("Present"), "csv status");
assert.ok(csv.includes("Ann Bee"), "csv name");
assert.ok(csv.includes("ADM1"), "csv admission");
assert.ok(csv.includes("Class Register"), "csv class register");
assert.ok(!csv.includes(",PRESENT,"), "csv must not dump raw enum as status column alone awkwardly");

console.log("attendanceReportCatalog.test.ts: PASS");
