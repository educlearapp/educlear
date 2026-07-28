/**
 * Attendance report summary / filter helpers (no DOM / no API).
 * Run: npx --yes tsx src/attendance/attendanceReportSummaries.test.ts
 */
import assert from "node:assert/strict";
import type { AttendanceReportPayload } from "./attendanceReportCatalog";
import { buildAttendanceExportFileName } from "./attendanceReportFileName";
import {
  buildClassroomSummaries,
  computeHeadlineAttendancePercentage,
  computeReportTotals,
  filterReportLearners,
  flattenAttendanceHistory,
  formatHeadlineAttendancePercentage,
} from "./attendanceReportSummaries";

const sampleReport: AttendanceReportPayload = {
  meta: {
    schoolId: "school-1",
    schoolName: "Test School",
    title: "Daily Attendance Register",
    startDate: "2026-07-28",
    endDate: "2026-07-28",
    period: "DAILY",
    periodLabel: "Daily",
    className: "Grade 3A",
    classroomScope: "SINGLE",
    includeWeekends: false,
    groupBy: "classrooms",
    timezone: "Africa/Johannesburg",
    generatedAt: "2026-07-28T10:00:00.000Z",
    generatedAtDisplay: "2026-07-28 12:00",
    holidayLimitation: "note",
  },
  dates: [
    {
      date: "2026-07-28",
      weekday: "Tuesday",
      weekdayShort: "Tue",
      dayOfMonth: 28,
      monthShort: "Jul",
      fullDateLabel: "Tuesday, 28 Jul 2026",
      headingWeekly: "Tue 28 Jul",
      headingMonthly: "28 Tue",
    },
  ],
  sections: [
    {
      key: "classroom:Grade 3A",
      label: "Grade 3A",
      type: "classroom",
      learners: [],
    },
  ],
  learners: [
    {
      learnerId: "l1",
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      admissionNo: "A001",
      classroom: "Grade 3A",
      groupNames: [],
      days: {
        "2026-07-28": {
          date: "2026-07-28",
          status: "PRESENT",
          statusLabel: "Present",
          statusAbbrev: "P",
          reason: "",
          capturedBy: "Teacher One",
          capturedAt: "2026-07-28T08:00:00.000Z",
          capturedAtDisplay: "2026-07-28 10:00",
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
    {
      learnerId: "l2",
      firstName: "Alan",
      lastName: "Turing",
      fullName: "Alan Turing",
      admissionNo: "A002",
      classroom: "Grade 3A",
      groupNames: [],
      days: {
        "2026-07-28": {
          date: "2026-07-28",
          status: "ABSENT",
          statusLabel: "Absent",
          statusAbbrev: "A",
          reason: "Sick",
          capturedBy: "Teacher One",
          capturedAt: "2026-07-28T08:01:00.000Z",
          capturedAtDisplay: "2026-07-28 10:01",
        },
      },
      totals: {
        present: 0,
        absent: 1,
        late: 0,
        excused: 0,
        notCaptured: 0,
        attended: 0,
        captured: 1,
        expected: 1,
        attendancePercentage: 0,
        captureCompletionPercentage: 100,
      },
    },
  ],
  summary: { learnerCount: 2, expectedSchoolDays: 1, sectionCount: 1 },
  emptyState: null,
  groupsAvailable: false,
  groupByDisabledReason: null,
};

sampleReport.sections[0].learners = sampleReport.learners;

const totals = computeReportTotals(sampleReport.learners);
assert.equal(totals.present, 1);
assert.equal(totals.absent, 1);
assert.equal(totals.learnerCount, 2);
// (Present + Late + Excused) / Total Learners = (1+0+0)/2 = 50.0%
assert.equal(computeHeadlineAttendancePercentage(totals), 50);
assert.equal(formatHeadlineAttendancePercentage(totals), "50.0%");
assert.equal(
  formatHeadlineAttendancePercentage({
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    notCaptured: 0,
    captured: 0,
    expected: 0,
    learnerCount: 0,
  }),
  "0.0%"
);
assert.equal(
  formatHeadlineAttendancePercentage({
    present: 19,
    absent: 0,
    late: 0,
    excused: 0,
    notCaptured: 0,
    captured: 19,
    expected: 19,
    learnerCount: 19,
  }),
  "100.0%"
);
assert.equal(
  formatHeadlineAttendancePercentage({
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    notCaptured: 395,
    captured: 0,
    expected: 395,
    learnerCount: 395,
  }),
  "0.0%"
);

const filtered = filterReportLearners(sampleReport, {
  learnerSearch: "turing",
  statusFilter: "Absent",
});
assert.equal(filtered.learners.length, 1);
assert.equal(filtered.learners[0].fullName, "Alan Turing");

const history = flattenAttendanceHistory(filtered);
assert.equal(history.length, 1);
assert.equal(history[0].reason, "Sick");

const summaries = buildClassroomSummaries(sampleReport);
assert.equal(summaries.length, 1);
assert.equal(summaries[0].present, 1);
assert.equal(summaries[0].absent, 1);

const filename = buildAttendanceExportFileName({
  schoolName: "Da Silva Academy",
  classroom: "Grade 3A",
  view: "daily",
  startDate: "2026-07-28",
  endDate: "2026-07-28",
  extension: "xlsx",
});
assert.match(filename, /Da-Silva-Academy_Grade-3A_Daily-Register_2026-07-28\.xlsx/);

console.log("attendanceReportSummaries.test.ts: ok");
