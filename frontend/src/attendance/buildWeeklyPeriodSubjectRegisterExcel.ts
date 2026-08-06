import * as XLSX from "xlsx";
import type { WeeklyPeriodSubjectRegisterReport } from "./weeklyPeriodSubjectRegisterTypes";
import {
  formatWeeklyRegisterCaptureTime,
  formatWeeklyRegisterTimestamp,
  weeklyAttendancePctLabel,
} from "./weeklyPeriodSubjectRegisterTypes";

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function slugPart(value: string, fallback: string): string {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function buildFileName(report: WeeklyPeriodSubjectRegisterReport): string {
  const school = slugPart(report.schoolName, "School");
  const classroom = slugPart(report.className, "Classroom");
  return `${school}_${classroom}_Weekly-Period-Subject-Register_${report.weekStart}_to_${report.weekEnd}.xlsx`;
}

export function buildWeeklyPeriodSubjectRegisterWorkbook(
  report: WeeklyPeriodSubjectRegisterReport,
  title: string
): XLSX.WorkBook {
  const rows: (string | number)[][] = [
    ["Report", title],
    ["School", report.schoolName],
    ["Week", `${report.weekStart} to ${report.weekEnd}`],
    ["Classroom", report.className],
    ["Display mode", `${report.displayModeRequested} (${report.displayModeResolved})`],
    ["Generated", formatWeeklyRegisterTimestamp(report.generatedAt)],
    ["Timezone", report.timezone],
    [],
    ["Summary"],
    ["Total Learners", report.summary.totalLearners],
    ["Scheduled Sessions", report.summary.scheduledSessions],
    ["Captured Sessions", report.summary.capturedSessions],
    ["Not Captured Sessions", report.summary.notCapturedSessions],
    ["Present", report.summary.present],
    ["Absent", report.summary.absent],
    ["Late", report.summary.late],
    ["Excused", report.summary.excused],
    ["Overall Attendance %", weeklyAttendancePctLabel(report.summary.overallAttendancePercentage)],
    ["Learners at 100%", report.summary.learnersWith100Percent],
    ["Learners below 90%", report.summary.learnersBelow90Percent],
    [],
  ];

  if (report.legacySubjectNotice) {
    rows.push(["Legacy notice", report.legacySubjectNotice], []);
  }

  const sessionHeaders = report.columns.map((c) => `${c.dayLabel} ${c.sessionLabel}`);
  rows.push(["Learner Name", "Grade", "Attendance %", ...sessionHeaders]);

  for (const learner of report.learners) {
    rows.push([
      learner.fullName,
      learner.grade,
      weeklyAttendancePctLabel(learner.attendancePercentage),
      ...learner.cells.map((c) => c.abbrev),
    ]);
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (rows.length > 1) {
    const colCount = Math.max(...rows.map((r) => r.length));
    const lastCol = XLSX.utils.encode_col(Math.max(0, colCount - 1));
    const headerIdx = rows.findIndex(
      (r) => typeof r[0] === "string" && r[0] === "Learner Name"
    );
    if (headerIdx >= 0) {
      sheet["!autofilter"] = {
        ref: `A${headerIdx + 1}:${lastCol}${rows.length}`,
      };
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "Weekly Register");

  // Legend worksheet
  const legendRows: (string | number)[][] = [
    ["Legend"],
    ["Code", "Meaning"],
    ...report.statusLegend.map((l) => [l.abbrev, l.label]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(legendRows), "Legend");

  // Detail worksheet — preserves reason codes + teacher notes
  const colByKey = new Map(report.columns.map((c) => [c.key, c]));
  const detailRows: (string | number)[][] = [
    [
      "Learner Name",
      "Grade",
      "Date",
      "Day",
      "Session",
      "Code",
      "Reason label",
      "Teacher note",
      "Original reason text",
      "Status",
      "Capture time",
      "Teacher",
    ],
  ];
  for (const learner of report.learners) {
    for (const cell of learner.cells) {
      if (cell.status === "NOT_CAPTURED" || cell.status === "NOT_SCHEDULED") continue;
      const col = colByKey.get(cell.columnKey);
      detailRows.push([
        learner.fullName,
        learner.grade,
        col?.date || "",
        col?.dayLabel || "",
        col?.sessionLabel || "",
        cell.abbrev,
        cell.label,
        cell.teacherNote || "",
        cell.reason || "",
        cell.status,
        formatWeeklyRegisterCaptureTime(cell.captureTime),
        cell.capturingTeacher || "",
      ]);
    }
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(detailRows), "Reason Details");

  return workbook;
}

export function downloadWeeklyPeriodSubjectRegisterExcel(
  report: WeeklyPeriodSubjectRegisterReport,
  title: string
) {
  const workbook = buildWeeklyPeriodSubjectRegisterWorkbook(report, title);
  const array = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadBlob(
    buildFileName(report),
    new Blob([array], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
}
