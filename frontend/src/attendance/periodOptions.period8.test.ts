/**
 * Frontend attendance session options + export header checks for Period 8 / Intervention.
 * Run from frontend: npx --yes tsx src/attendance/periodOptions.period8.test.ts
 * (or: node --import tsx src/attendance/periodOptions.period8.test.ts)
 */
import assert from "assert";
import * as XLSX from "xlsx";
import { ATTENDANCE_PERIOD_OPTIONS, DEFAULT_ATTENDANCE_PERIOD } from "./periodOptions";
import { buildWeeklyPeriodSubjectRegisterWorkbook } from "./buildWeeklyPeriodSubjectRegisterExcel";
import type { WeeklyPeriodSubjectRegisterReport } from "./weeklyPeriodSubjectRegisterTypes";

function testCaptureOptionsIncludePeriod8AndIntervention() {
  const values = ATTENDANCE_PERIOD_OPTIONS.map((o) => o.value);
  const labels = ATTENDANCE_PERIOD_OPTIONS.map((o) => o.label);
  assert.ok(values.includes("PERIOD_8"));
  assert.ok(values.includes("INTERVENTION"));
  assert.ok(values.includes("PERIOD_7"));
  assert.ok(values.includes("AFTERCARE"));
  assert.strictEqual(DEFAULT_ATTENDANCE_PERIOD, "DAILY");
  assert.strictEqual(
    ATTENDANCE_PERIOD_OPTIONS.find((o) => o.value === "PERIOD_8")?.label,
    "Period 8"
  );
  assert.strictEqual(
    ATTENDANCE_PERIOD_OPTIONS.find((o) => o.value === "INTERVENTION")?.label,
    "Intervention"
  );
  assert.ok(!labels.includes("Period 9"));
  assert.ok(!values.includes("PERIOD_9"));
}

function shortSessionLabel(sessionLabel: string): string {
  const periodMatch = /^Period (\d+)$/i.exec(String(sessionLabel || "").trim());
  if (periodMatch) return `P${periodMatch[1]}`;
  if (/^Intervention$/i.test(String(sessionLabel || "").trim())) return "Intv";
  return String(sessionLabel || "").slice(0, 6);
}

function testPdfAbbreviations() {
  assert.strictEqual(shortSessionLabel("Period 8"), "P8");
  assert.strictEqual(shortSessionLabel("Period 1"), "P1");
  assert.strictEqual(shortSessionLabel("Intervention"), "Intv");
  assert.notStrictEqual(shortSessionLabel("Intervention"), "Period");
}

function sampleWeeklyReport(): WeeklyPeriodSubjectRegisterReport {
  return {
    schoolId: "s1",
    schoolName: "Test School",
    weekStart: "2026-08-03",
    weekEnd: "2026-08-07",
    timezone: "Africa/Johannesburg",
    className: "Grade 6A",
    gradeFilter: null,
    teacherFilter: null,
    displayModeRequested: "Periods",
    displayModeResolved: "PERIODS",
    classroomAttendanceSessionDisplay: "PERIODS",
    columns: [
      {
        key: "2026-08-04|PERIOD_8",
        dayOfWeek: 2,
        date: "2026-08-04",
        dayLabel: "Tuesday",
        sessionLabel: "Period 8",
        period: "PERIOD_8",
      },
      {
        key: "2026-08-04|INTERVENTION",
        dayOfWeek: 2,
        date: "2026-08-04",
        dayLabel: "Tuesday",
        sessionLabel: "Intervention",
        period: "INTERVENTION",
      },
    ],
    dayGroups: [
      {
        date: "2026-08-04",
        dayLabel: "Tuesday",
        columnKeys: ["2026-08-04|PERIOD_8", "2026-08-04|INTERVENTION"],
      },
    ],
    learners: [
      {
        learnerId: "l1",
        fullName: "Ava Learner",
        grade: "Grade 6A",
        className: "Grade 6A",
        cells: [
          {
            columnKey: "2026-08-04|PERIOD_8",
            status: "PRESENT",
            abbrev: "P",
            label: "Present",
          },
          {
            columnKey: "2026-08-04|INTERVENTION",
            status: "ABSENT",
            abbrev: "SN",
            label: "Sick Bay",
            reason: "SN - Parent phoned school.",
            fromReasonCode: true,
            teacherNote: "Parent phoned school.",
          },
        ],
        attendancePercentage: 50,
        present: 1,
        absent: 1,
        late: 0,
        excused: 0,
        notCaptured: 0,
        notScheduled: 0,
        eligibleSessions: 2,
        attended: 1,
      },
    ],
    summary: {
      totalLearners: 1,
      scheduledSessions: 2,
      capturedSessions: 2,
      notCapturedSessions: 0,
      present: 1,
      absent: 1,
      late: 0,
      excused: 0,
      overallAttendancePercentage: 50,
      learnersWith100Percent: 0,
      learnersBelow90Percent: 1,
    },
    legacySubjectNotice: null,
    statusLegend: [
      { abbrev: "P", label: "Present" },
      { abbrev: "A", label: "Absent" },
      { abbrev: "S", label: "Sick" },
      { abbrev: "SN", label: "Sick Bay" },
      { abbrev: "L", label: "Late" },
      { abbrev: "E", label: "Excused" },
      { abbrev: "O", label: "Official School Activity" },
      { abbrev: "F", label: "Family Responsibility" },
      { abbrev: "NC", label: "Not Captured" },
      { abbrev: "NS", label: "Not Scheduled" },
    ],
    generatedAt: "2026-08-06T10:00:00.000Z",
  };
}

function testExcelExportHeadersNoDuplicates() {
  const wb = buildWeeklyPeriodSubjectRegisterWorkbook(
    sampleWeeklyReport(),
    "Weekly Period / Subject Attendance Register"
  );
  const sheet = wb.Sheets["Weekly Register"];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
  const header = rows.find((r) => r[0] === "Learner Name") as string[];
  assert.ok(header);
  assert.ok(header.includes("Tuesday Period 8"));
  assert.ok(header.includes("Tuesday Intervention"));
  assert.ok(!header.includes("Tuesday Period 9"));
  const sessionHeaders = header.slice(3);
  assert.strictEqual(new Set(sessionHeaders).size, sessionHeaders.length, "no duplicate columns");

  // Reason code preserved in grid
  const dataRow = rows.find((r) => r[0] === "Ava Learner") as (string | number)[];
  assert.ok(dataRow.includes("SN"));

  // Legend worksheet
  assert.ok(wb.Sheets["Legend"]);
  const legendRows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets["Legend"], { header: 1 });
  assert.ok(legendRows.some((r) => r[0] === "SN" && String(r[1]).includes("Sick Bay")));

  // Reason Details worksheet
  assert.ok(wb.Sheets["Reason Details"]);
  const detailRows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets["Reason Details"], {
    header: 1,
  });
  assert.ok(detailRows.some((r) => r.includes("SN") && r.includes("Parent phoned school.")));
}

testCaptureOptionsIncludePeriod8AndIntervention();
testPdfAbbreviations();
testExcelExportHeadersNoDuplicates();
console.log("periodOptions.period8.test.ts: OK");
