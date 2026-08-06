import jsPDF from "jspdf";
import type { WeeklyPeriodSubjectRegisterReport } from "./weeklyPeriodSubjectRegisterTypes";
import {
  formatWeeklyRegisterTimestamp,
  weeklyAttendancePctLabel,
} from "./weeklyPeriodSubjectRegisterTypes";

const NAVY = "#0f172a";
const GOLD = "#d4af37";

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
  return `${school}_${classroom}_Weekly-Period-Subject-Register_${report.weekStart}_to_${report.weekEnd}.pdf`;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed <= pageH - 14) return y;
  doc.addPage("a4", "landscape");
  return 14;
}

function drawHeader(doc: jsPDF, report: WeeklyPeriodSubjectRegisterReport, title: string): number {
  let y = 14;
  doc.setFillColor(11, 28, 51);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(212, 175, 55);
  doc.text("EDUCLEAR · WEEKLY PERIOD / SUBJECT REGISTER", 14, 10);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(report.schoolName || "School", 14, 18);

  y = 28;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.text(title, 14, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const meta = [
    `Week: ${report.weekStart} to ${report.weekEnd}`,
    `Classroom: ${report.className}`,
    `Display: ${report.displayModeRequested} (${report.displayModeResolved})`,
  ];
  for (const line of meta) {
    doc.text(line, 14, y);
    y += 4.5;
  }
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(14, y + 1, doc.internal.pageSize.getWidth() - 14, y + 1);
  return y + 8;
}

function drawSummary(doc: jsPDF, report: WeeklyPeriodSubjectRegisterReport, y: number): number {
  y = ensureSpace(doc, y, 22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("Summary", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const s = report.summary;
  doc.text(
    `Learners: ${s.totalLearners}   Scheduled: ${s.scheduledSessions}   Captured: ${s.capturedSessions}   NC: ${s.notCapturedSessions}   P/A/L/E: ${s.present}/${s.absent}/${s.late}/${s.excused}   Attendance %: ${weeklyAttendancePctLabel(s.overallAttendancePercentage)}`,
    14,
    y
  );
  y += 5;
  doc.text(
    `100% learners: ${s.learnersWith100Percent}   Below 90%: ${s.learnersBelow90Percent}`,
    14,
    y
  );
  return y + 7;
}

function drawLegend(doc: jsPDF, report: WeeklyPeriodSubjectRegisterReport, y: number): number {
  y = ensureSpace(doc, y, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("Legend", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const pageW = doc.internal.pageSize.getWidth();
  const chunks: string[] = [];
  let line = "";
  for (const item of report.statusLegend) {
    const part = `${item.abbrev} = ${item.label}`;
    const next = line ? `${line}   ${part}` : part;
    if (next.length > 120) {
      if (line) chunks.push(line);
      line = part;
    } else {
      line = next;
    }
  }
  if (line) chunks.push(line);
  for (const chunk of chunks) {
    y = ensureSpace(doc, y, 5);
    doc.text(chunk, 14, y, { maxWidth: pageW - 28 });
    y += 4.2;
  }
  return y + 4;
}

function shortSessionLabel(sessionLabel: string): string {
  const periodMatch = /^Period (\d+)$/i.exec(String(sessionLabel || "").trim());
  if (periodMatch) return `P${periodMatch[1]}`;
  if (/^Intervention$/i.test(String(sessionLabel || "").trim())) return "Intv";
  return String(sessionLabel || "").slice(0, 6);
}

function drawGrid(doc: jsPDF, report: WeeklyPeriodSubjectRegisterReport, y: number): number {
  const pageW = doc.internal.pageSize.getWidth();
  const nameW = 38;
  const gradeW = 14;
  const pctW = 14;
  const colCount = report.columns.length;
  const avail = pageW - 28 - nameW - gradeW - pctW;
  const cellW = Math.max(5.5, Math.min(10, avail / Math.max(1, colCount)));

  y = ensureSpace(doc, y, 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  let x = 14;
  doc.text("Learner", x, y);
  x += nameW;
  doc.text("Gr", x, y);
  x += gradeW;
  doc.text("%", x, y);
  x += pctW;
  for (const col of report.columns) {
    const label = `${col.dayLabel.slice(0, 3)} ${shortSessionLabel(col.sessionLabel)}`;
    doc.text(label, x, y, { maxWidth: cellW });
    x += cellW;
  }
  y += 3;
  doc.setDrawColor(226, 232, 240);
  doc.line(14, y, pageW - 14, y);
  y += 3;

  doc.setFont("helvetica", "normal");
  for (const learner of report.learners) {
    y = ensureSpace(doc, y, 5);
    x = 14;
    doc.setFontSize(6.5);
    doc.text(learner.fullName.slice(0, 24), x, y);
    x += nameW;
    doc.text(String(learner.grade || "").slice(0, 6), x, y);
    x += gradeW;
    doc.text(weeklyAttendancePctLabel(learner.attendancePercentage).replace("%", ""), x, y);
    x += pctW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    for (const cell of learner.cells) {
      doc.text(cell.abbrev, x + 1, y);
      x += cellW;
    }
    doc.setFont("helvetica", "normal");
    y += 4;
  }
  return y + 4;
}

function drawFooter(doc: jsPDF, report: WeeklyPeriodSubjectRegisterReport) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    const pageW = doc.internal.pageSize.getWidth();
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.4);
    doc.line(14, pageH - 10, pageW - 14, pageH - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Generated ${formatWeeklyRegisterTimestamp(report.generatedAt)} · ${report.timezone}`,
      14,
      pageH - 6
    );
    doc.text(`Page ${i} of ${pageCount}`, pageW - 14, pageH - 6, { align: "right" });
  }
}

export function downloadWeeklyPeriodSubjectRegisterPdf(
  report: WeeklyPeriodSubjectRegisterReport,
  title: string
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let y = drawHeader(doc, report, title);
  y = drawSummary(doc, report, y);
  if (report.legacySubjectNotice) {
    y = ensureSpace(doc, y, 10);
    doc.setFontSize(7.5);
    doc.setTextColor(146, 64, 14);
    doc.text(report.legacySubjectNotice.slice(0, 180), 14, y, { maxWidth: doc.internal.pageSize.getWidth() - 28 });
    y += 8;
  }
  y = drawLegend(doc, report, y);
  drawGrid(doc, report, y);
  drawFooter(doc, report);
  doc.save(buildFileName(report));
}

void NAVY;
void GOLD;
