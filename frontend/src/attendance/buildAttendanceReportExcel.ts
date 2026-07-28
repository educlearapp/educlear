import * as XLSX from "xlsx";
import type {
  AttendanceRegisterKind,
  AttendanceReportPayload,
} from "./attendanceReportCatalog";
import {
  buildAttendanceExportFileName,
  type AttendanceExportView,
} from "./attendanceReportFileName";
import {
  buildClassroomSummaries,
  computeReportTotals,
  flattenAttendanceHistory,
  formatHeadlineAttendancePercentage,
  type ClassroomSummaryRow,
} from "./attendanceReportSummaries";

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sheetFromAoA(rows: (string | number)[][], sheetName: string): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (rows.length > 1) {
    const colCount = Math.max(...rows.map((r) => r.length));
    // Prefer the blank row immediately before the widest data header (register columns).
    let headerRow = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length >= 5 && typeof rows[i][0] === "string" && /Learner Name|Classroom|Metric/i.test(String(rows[i][0]))) {
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) {
      for (let i = 0; i < Math.min(rows.length, 40); i++) {
        if (rows[i].length === 0) headerRow = i + 1;
      }
    }
    if (headerRow >= 0 && headerRow < rows.length) {
      const lastCol = XLSX.utils.encode_col(Math.max(0, colCount - 1));
      sheet["!autofilter"] = {
        ref: `A${headerRow + 1}:${lastCol}${rows.length}`,
      };
    }
  }
  return sheet;
}

function metaRows(
  report: AttendanceReportPayload,
  title: string
): (string | number)[][] {
  return [
    ["Report", title],
    ["School", report.meta.schoolName],
    ["Classroom", report.meta.className || "All Classrooms"],
    ["Register type", report.meta.periodLabel],
    ["Date range", `${report.meta.startDate} to ${report.meta.endDate}`],
    ["Timezone", report.meta.timezone],
    ["Generated", report.meta.generatedAtDisplay],
    ["Holiday note", report.meta.holidayLimitation],
    [],
  ];
}

function summaryRows(report: AttendanceReportPayload): (string | number)[][] {
  const totals = computeReportTotals(report.learners);
  return [
    ["Summary"],
    ["Total Learners", totals.learnerCount],
    ["Present", totals.present],
    ["Absent", totals.absent],
    ["Late", totals.late],
    ["Excused", totals.excused],
    ["Not Captured", totals.notCaptured],
    ["Attendance %", formatHeadlineAttendancePercentage(totals)],
    [],
  ];
}

function totalsRows(report: AttendanceReportPayload): (string | number)[][] {
  const totals = computeReportTotals(report.learners);
  return [
    [],
    ["Totals"],
    ["Total Learners", totals.learnerCount],
    ["Present", totals.present],
    ["Absent", totals.absent],
    ["Late", totals.late],
    ["Excused", totals.excused],
    ["Not Captured", totals.notCaptured],
    ["Attendance %", formatHeadlineAttendancePercentage(totals)],
  ];
}

function buildDailyRows(report: AttendanceReportPayload, title: string): (string | number)[][] {
  const dateCol = report.dates[0];
  const body: (string | number)[][] = [
    ...metaRows(report, title),
    ...summaryRows(report),
    [
      "Learner Name",
      "Surname",
      "Admission Number",
      "Classroom",
      "Register type",
      "Day of week",
      "Full date",
      "Attendance status",
      "Reason",
      "Captured by",
      "Server capture time",
    ],
  ];
  for (const section of report.sections) {
    for (const learner of section.learners) {
      const day = dateCol ? learner.days[dateCol.date] : undefined;
      body.push([
        learner.firstName,
        learner.lastName,
        learner.admissionNo,
        learner.classroom,
        report.meta.periodLabel,
        dateCol?.weekday || "",
        dateCol?.fullDateLabel || report.meta.startDate,
        day?.statusLabel || "Not Captured",
        day?.reason || "",
        day?.capturedBy || "",
        day?.capturedAtDisplay || "",
      ]);
    }
  }
  return [...body, ...totalsRows(report)];
}

function buildGridRows(
  report: AttendanceReportPayload,
  kind: AttendanceRegisterKind,
  title: string
): (string | number)[][] {
  const dayHeaders = report.dates.map((d) =>
    kind === "monthly" ? d.headingMonthly : d.headingWeekly
  );
  const body: (string | number)[][] = [
    ...metaRows(report, title),
    ...summaryRows(report),
    [
      "Learner Name",
      "Surname",
      "Admission Number",
      "Classroom",
      "Register type",
      ...dayHeaders,
      "Present",
      "Absent",
      "Late",
      "Excused",
      "Not Captured",
      "Attendance %",
      "Capture %",
    ],
  ];
  for (const section of report.sections) {
    for (const learner of section.learners) {
      body.push([
        learner.firstName,
        learner.lastName,
        learner.admissionNo,
        learner.classroom,
        report.meta.periodLabel,
        ...report.dates.map((d) => learner.days[d.date]?.statusAbbrev || "N"),
        learner.totals.present,
        learner.totals.absent,
        learner.totals.late,
        learner.totals.excused,
        learner.totals.notCaptured,
        learner.totals.attendancePercentage,
        learner.totals.captureCompletionPercentage,
      ]);
    }
  }
  body.push([]);
  body.push(["Legend", "P=Present", "A=Absent", "L=Late", "E=Excused", "N=Not Captured"]);
  return [...body, ...totalsRows(report)];
}

function buildLearnerHistoryRows(
  report: AttendanceReportPayload,
  title: string
): (string | number)[][] {
  const flat = flattenAttendanceHistory(report);
  const body: (string | number)[][] = [
    ...metaRows(report, title),
    ...summaryRows(report),
    [
      "Learner Name",
      "Admission Number",
      "Classroom",
      "Register type",
      "Day of week",
      "Full date",
      "Attendance status",
      "Abbreviation",
      "Reason",
      "Captured by",
      "Server capture time",
    ],
  ];
  for (const row of flat) {
    body.push([
      row.fullName,
      row.admissionNo,
      row.classroom,
      report.meta.periodLabel,
      row.weekday,
      row.fullDateLabel,
      row.statusLabel,
      row.statusAbbrev,
      row.reason,
      row.capturedBy,
      row.capturedAtDisplay,
    ]);
  }
  return [...body, ...totalsRows(report)];
}

function buildClassroomSummaryRows(
  report: AttendanceReportPayload,
  title: string,
  rows: ClassroomSummaryRow[]
): (string | number)[][] {
  const body: (string | number)[][] = [
    ...metaRows(report, title),
    ...summaryRows(report),
    [
      "Classroom",
      "Learners",
      "Present",
      "Absent",
      "Late",
      "Excused",
      "Not Captured",
      "Attendance %",
      "Capture %",
    ],
  ];
  for (const row of rows) {
    body.push([
      row.classroom,
      row.learnerCount,
      row.present,
      row.absent,
      row.late,
      row.excused,
      row.notCaptured,
      row.attendancePercentage,
      row.captureCompletionPercentage,
    ]);
  }
  return [...body, ...totalsRows(report)];
}

function buildSchoolSummaryRows(
  report: AttendanceReportPayload,
  title: string
): (string | number)[][] {
  const totals = computeReportTotals(report.learners);
  const capturePct =
    totals.expected === 0 ? 0 : Math.round((totals.captured / totals.expected) * 1000) / 10;
  return [
    ...metaRows(report, title),
    ...summaryRows(report),
    ["Metric", "Value"],
    ["School", report.meta.schoolName],
    ["Register type", report.meta.periodLabel],
    ["Date range", `${report.meta.startDate} to ${report.meta.endDate}`],
    ["Expected marks", totals.expected],
    ["Capture completion %", capturePct],
  ];
}

export function buildAttendanceReportWorkbook(
  report: AttendanceReportPayload,
  view: AttendanceExportView,
  title: string
): XLSX.WorkBook {
  const kind: AttendanceRegisterKind =
    view === "weekly" ? "weekly" : view === "monthly" ? "monthly" : view === "list" ? "list" : "daily";

  let rows: (string | number)[][];
  if (view === "classroom_summary") {
    rows = buildClassroomSummaryRows(report, title, buildClassroomSummaries(report));
  } else if (view === "school_summary") {
    rows = buildSchoolSummaryRows(report, title);
  } else if (view === "learner") {
    rows = buildLearnerHistoryRows(report, title);
  } else if (view === "weekly" || view === "monthly") {
    rows = buildGridRows(report, kind, title);
  } else {
    rows = buildDailyRows(report, title);
  }

  const workbook = XLSX.utils.book_new();
  const sheet = sheetFromAoA(rows, "Attendance");
  XLSX.utils.book_append_sheet(workbook, sheet, "Attendance");
  return workbook;
}

export function downloadAttendanceReportExcel(
  report: AttendanceReportPayload,
  view: AttendanceExportView,
  title: string
) {
  const workbook = buildAttendanceReportWorkbook(report, view, title);
  const filename = buildAttendanceExportFileName({
    schoolName: report.meta.schoolName,
    classroom: report.meta.className,
    view,
    startDate: report.meta.startDate,
    endDate: report.meta.endDate,
    extension: "xlsx",
  });
  const array = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadBlob(
    filename,
    new Blob([array], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
}
