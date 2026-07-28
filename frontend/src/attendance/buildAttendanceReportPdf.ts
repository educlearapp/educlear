import jsPDF from "jspdf";
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
} from "./attendanceReportSummaries";

const NAVY = "#0f172a";
const GOLD = "#d4af37";

function downloadPdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}

function drawHeader(doc: jsPDF, report: AttendanceReportPayload, title: string, yStart = 14) {
  let y = yStart;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("CLASS REGISTER", 14, y);
  y += 7;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  doc.text(report.meta.schoolName || "School", 14, y);
  y += 7;
  doc.setFontSize(12);
  doc.text(title, 14, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const lines = [
    `Classroom: ${report.meta.className || "All Classrooms"}`,
    `Register type: ${report.meta.periodLabel}`,
    `Date range: ${report.meta.startDate} to ${report.meta.endDate}`,
    `Generated: ${report.meta.generatedAtDisplay}`,
  ];
  for (const line of lines) {
    doc.text(line, 14, y);
    y += 4.5;
  }
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(14, y + 1, doc.internal.pageSize.getWidth() - 14, y + 1);
  return y + 8;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, landscape: boolean): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed <= pageH - 12) return y;
  doc.addPage(landscape ? "a4" : "a4", landscape ? "landscape" : "portrait");
  return 14;
}

function drawTotals(doc: jsPDF, report: AttendanceReportPayload, y: number, landscape: boolean) {
  const totals = computeReportTotals(report.learners);
  y = ensureSpace(doc, y, 28, landscape);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("Summary", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `Total Learners: ${totals.learnerCount}   Present: ${totals.present}   Absent: ${totals.absent}   Late: ${totals.late}   Excused: ${totals.excused}   Not Captured: ${totals.notCaptured}   Attendance %: ${formatHeadlineAttendancePercentage(totals)}`,
    14,
    y
  );
  return y + 8;
}

function drawDailyRegister(doc: jsPDF, report: AttendanceReportPayload, title: string) {
  let y = drawHeader(doc, report, title);
  y = drawTotals(doc, report, y, false);
  const dateCol = report.dates[0];
  const pageW = doc.internal.pageSize.getWidth();

  for (const section of report.sections) {
    y = ensureSpace(doc, y, 20, false);
    doc.setFillColor(253, 246, 227);
    doc.rect(14, y - 4, pageW - 28, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Class: ${section.label}`, 16, y);
    y += 8;

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const headers = ["Learner", "Status", "Reason", "Captured by", "Capture time"];
    const widths = [48, 24, 40, 36, 36];
    let x = 14;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x, y);
      x += widths[i];
    }
    y += 4;
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y, pageW - 14, y);
    y += 4;

    doc.setFont("helvetica", "normal");
    for (const learner of section.learners) {
      y = ensureSpace(doc, y, 8, false);
      const day = dateCol ? learner.days[dateCol.date] : undefined;
      const cells = [
        learner.fullName,
        day?.statusLabel || "Not Captured",
        day?.reason || "—",
        day?.capturedBy || "—",
        day?.capturedAtDisplay || "—",
      ];
      x = 14;
      for (let i = 0; i < cells.length; i++) {
        doc.text(String(cells[i]).slice(0, widths[i] > 30 ? 28 : 16), x, y);
        x += widths[i];
      }
      y += 5;
    }
    y += 4;
  }

  if (dateCol) {
    y = ensureSpace(doc, y, 10, false);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${dateCol.weekday} · ${dateCol.fullDateLabel} · Register: ${report.meta.periodLabel}`,
      14,
      y
    );
    y += 6;
  }
  drawTotals(doc, report, y, false);
}

function drawGridRegister(
  doc: jsPDF,
  report: AttendanceReportPayload,
  title: string,
  kind: AttendanceRegisterKind
) {
  let y = drawHeader(doc, report, title);
  y = drawTotals(doc, report, y, true);
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("Legend: P=Present  A=Absent  L=Late  E=Excused  N=Not Captured", 14, y);
  y += 7;

  for (const section of report.sections) {
    y = ensureSpace(doc, y, 24, true);
    doc.setFillColor(253, 246, 227);
    doc.rect(14, y - 4, pageW - 28, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Class: ${section.label}`, 16, y);
    y += 8;

    const nameW = 42;
    const dateCount = report.dates.length;
    const avail = pageW - 28 - nameW - 50;
    const dayW = Math.max(6, Math.min(12, avail / Math.max(1, dateCount)));

    doc.setFontSize(6.5);
    let x = 14;
    doc.text("Learner", x, y);
    x += nameW;
    for (const d of report.dates) {
      const label = kind === "monthly" ? d.headingMonthly : d.headingWeekly;
      doc.text(label.slice(0, 8), x, y, { maxWidth: dayW });
      x += dayW;
    }
    doc.text("P/A/L/E/N", x, y);
    y += 4;
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y, pageW - 14, y);
    y += 3.5;

    doc.setFont("helvetica", "normal");
    for (const learner of section.learners) {
      y = ensureSpace(doc, y, 6, true);
      x = 14;
      doc.setFontSize(7);
      doc.text(learner.fullName.slice(0, 28), x, y);
      x += nameW;
      doc.setFont("helvetica", "bold");
      for (const d of report.dates) {
        doc.text(learner.days[d.date]?.statusAbbrev || "N", x + 1, y);
        x += dayW;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text(
        `${learner.totals.present}/${learner.totals.absent}/${learner.totals.late}/${learner.totals.excused}/${learner.totals.notCaptured}`,
        x,
        y
      );
      y += 4.5;
    }
    y += 4;
  }
  drawTotals(doc, report, y, true);
}

function drawLearnerHistory(doc: jsPDF, report: AttendanceReportPayload, title: string) {
  let y = drawHeader(doc, report, title);
  y = drawTotals(doc, report, y, false);
  const rows = flattenAttendanceHistory(report);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const headers = ["Date", "Learner", "Class", "Status", "Reason", "Captured by"];
  const widths = [38, 42, 28, 22, 30, 30];
  let x = 14;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, y);
    x += widths[i];
  }
  y += 5;
  doc.setFont("helvetica", "normal");
  for (const row of rows) {
    y = ensureSpace(doc, y, 6, false);
    const cells = [
      row.fullDateLabel,
      row.fullName,
      row.classroom,
      row.statusLabel,
      row.reason || "—",
      row.capturedBy || "—",
    ];
    x = 14;
    for (let i = 0; i < cells.length; i++) {
      doc.text(String(cells[i]).slice(0, 22), x, y);
      x += widths[i];
    }
    y += 4.5;
  }
  drawTotals(doc, report, y + 2, false);
}

function drawClassroomSummary(doc: jsPDF, report: AttendanceReportPayload, title: string) {
  let y = drawHeader(doc, report, title);
  y = drawTotals(doc, report, y, false);
  const rows = buildClassroomSummaries(report);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const headers = ["Classroom", "Learners", "P", "A", "L", "E", "N", "Att%", "Cap%"];
  const widths = [40, 18, 14, 14, 14, 14, 14, 16, 16];
  let x = 14;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, y);
    x += widths[i];
  }
  y += 5;
  doc.setFont("helvetica", "normal");
  for (const row of rows) {
    y = ensureSpace(doc, y, 6, false);
    const cells = [
      row.classroom,
      String(row.learnerCount),
      String(row.present),
      String(row.absent),
      String(row.late),
      String(row.excused),
      String(row.notCaptured),
      `${row.attendancePercentage}%`,
      `${row.captureCompletionPercentage}%`,
    ];
    x = 14;
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i], x, y);
      x += widths[i];
    }
    y += 5;
  }
  drawTotals(doc, report, y + 2, false);
}

function drawSchoolSummary(doc: jsPDF, report: AttendanceReportPayload, title: string) {
  let y = drawHeader(doc, report, title);
  const totals = computeReportTotals(report.learners);
  const capturePct =
    totals.expected === 0 ? 0 : Math.round((totals.captured / totals.expected) * 1000) / 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Whole-school attendance summary", 14, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const lines = [
    `School: ${report.meta.schoolName}`,
    `Register type: ${report.meta.periodLabel}`,
    `Date range: ${report.meta.startDate} to ${report.meta.endDate}`,
    `Total Learners: ${totals.learnerCount}`,
    `Present: ${totals.present}`,
    `Absent: ${totals.absent}`,
    `Late: ${totals.late}`,
    `Excused: ${totals.excused}`,
    `Not Captured: ${totals.notCaptured}`,
    `Attendance %: ${formatHeadlineAttendancePercentage(totals)}`,
    `Capture completion %: ${capturePct}%`,
  ];
  for (const line of lines) {
    doc.text(line, 14, y);
    y += 6;
  }
}

export function downloadAttendanceReportPdf(
  report: AttendanceReportPayload,
  view: AttendanceExportView,
  title: string
) {
  const landscape = view === "weekly" || view === "monthly";
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });

  if (view === "classroom_summary") {
    drawClassroomSummary(doc, report, title);
  } else if (view === "school_summary") {
    drawSchoolSummary(doc, report, title);
  } else if (view === "learner") {
    drawLearnerHistory(doc, report, title);
  } else if (view === "weekly" || view === "monthly") {
    drawGridRegister(doc, report, title, view);
  } else {
    drawDailyRegister(doc, report, title);
  }

  const filename = buildAttendanceExportFileName({
    schoolName: report.meta.schoolName,
    classroom: report.meta.className,
    view,
    startDate: report.meta.startDate,
    endDate: report.meta.endDate,
    extension: "pdf",
  });
  downloadPdf(doc, filename);
}

// Keep colour constants referenced for future theming consistency.
void NAVY;
void GOLD;
