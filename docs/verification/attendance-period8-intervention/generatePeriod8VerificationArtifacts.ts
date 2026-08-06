/**
 * Generate Excel + PDF + HTML verification artifacts for Period 8 / Intervention.
 * Run: npx --yes tsx src/attendance/generatePeriod8VerificationArtifacts.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { fileURLToPath } from "url";
import { ATTENDANCE_PERIOD_OPTIONS } from "../../../frontend/src/attendance/periodOptions";
import { buildWeeklyPeriodSubjectRegisterWorkbook } from "../../../frontend/src/attendance/buildWeeklyPeriodSubjectRegisterExcel";
import type { WeeklyPeriodSubjectRegisterReport } from "../../../frontend/src/attendance/weeklyPeriodSubjectRegisterTypes";

const OUT = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const periods = [
  "PERIOD_1",
  "PERIOD_2",
  "PERIOD_3",
  "PERIOD_4",
  "PERIOD_5",
  "PERIOD_6",
  "PERIOD_7",
  "PERIOD_8",
] as const;

function periodLabel(p: string) {
  return ATTENDANCE_PERIOD_OPTIONS.find((o) => o.value === p)?.label || p;
}

function shortSessionLabel(sessionLabel: string): string {
  const periodMatch = /^Period (\d+)$/i.exec(String(sessionLabel || "").trim());
  if (periodMatch) return `P${periodMatch[1]}`;
  if (/^Intervention$/i.test(String(sessionLabel || "").trim())) return "Intv";
  return String(sessionLabel || "").slice(0, 6);
}

function buildReport(): WeeklyPeriodSubjectRegisterReport {
  const date = "2026-08-04";
  const dayLabel = "Tuesday";
  const columns = [
    ...periods.map((period) => ({
      key: `${date}|${period}`,
      dayOfWeek: 2,
      date,
      dayLabel,
      sessionLabel: periodLabel(period),
      period,
    })),
    {
      key: `${date}|INTERVENTION`,
      dayOfWeek: 2,
      date,
      dayLabel,
      sessionLabel: "Intervention",
      period: "INTERVENTION",
    },
  ];
  return {
    schoolId: "verify",
    schoolName: "EduClear Verification School",
    weekStart: "2026-08-03",
    weekEnd: "2026-08-07",
    timezone: "Africa/Johannesburg",
    className: "Grade 6A",
    gradeFilter: null,
    teacherFilter: null,
    displayModeRequested: "Periods",
    displayModeResolved: "PERIODS",
    classroomAttendanceSessionDisplay: "PERIODS",
    columns,
    dayGroups: [{ date, dayLabel, columnKeys: columns.map((c) => c.key) }],
    learners: [
      {
        learnerId: "1",
        fullName: "Ava Learner",
        grade: "Grade 6A",
        className: "Grade 6A",
        cells: columns.map((c) => ({
          columnKey: c.key,
          status: c.period === "INTERVENTION" ? ("LATE" as const) : ("PRESENT" as const),
          abbrev: c.period === "INTERVENTION" ? "L" : "P",
          label: c.period === "INTERVENTION" ? "Late" : "Present",
        })),
        attendancePercentage: 100,
        present: 8,
        absent: 0,
        late: 1,
        excused: 0,
        notCaptured: 0,
        notScheduled: 0,
        eligibleSessions: 9,
        attended: 9,
      },
    ],
    summary: {
      totalLearners: 1,
      scheduledSessions: 9,
      capturedSessions: 9,
      notCapturedSessions: 0,
      present: 8,
      absent: 0,
      late: 1,
      excused: 0,
      overallAttendancePercentage: 100,
      learnersWith100Percent: 1,
      learnersBelow90Percent: 0,
    },
    legacySubjectNotice: null,
    statusLegend: [
      { abbrev: "P", label: "Present" },
      { abbrev: "A", label: "Absent" },
      { abbrev: "L", label: "Late" },
      { abbrev: "E", label: "Excused" },
      { abbrev: "NC", label: "Not Captured" },
      { abbrev: "NS", label: "Not Scheduled" },
    ],
    generatedAt: new Date().toISOString(),
  };
}

const report = buildReport();
const columns = report.columns;
const wb = buildWeeklyPeriodSubjectRegisterWorkbook(
  report,
  "Weekly Period / Subject Attendance Register"
);
XLSX.writeFile(wb, path.join(OUT, "weekly-period-register-period8-intervention.xlsx"));

const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
doc.setFont("helvetica", "bold");
doc.setFontSize(14);
doc.text(report.schoolName, 14, 16);
doc.setFontSize(11);
doc.text("Weekly Period / Subject Attendance Register", 14, 24);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
doc.text(`Week ${report.weekStart} to ${report.weekEnd} · ${report.className}`, 14, 30);
doc.text(
  `Sessions: ${report.columns.map((c) => c.sessionLabel).join(", ")}`,
  14,
  36,
  { maxWidth: 270 }
);
let x = 14;
let y = 48;
doc.setFontSize(7);
doc.text("Learner", x, y);
x += 40;
for (const col of report.columns) {
  doc.text(`${col.dayLabel.slice(0, 3)} ${shortSessionLabel(col.sessionLabel)}`, x, y);
  x += 12;
}
y += 6;
x = 14;
doc.text(report.learners[0].fullName, x, y);
x += 40;
for (const cell of report.learners[0].cells) {
  doc.text(cell.abbrev, x, y);
  x += 12;
}
fs.writeFileSync(
  path.join(OUT, "weekly-period-register-period8-intervention.pdf"),
  Buffer.from(doc.output("arraybuffer"))
);

const optionsHtml = ATTENDANCE_PERIOD_OPTIONS.map(
  (o) =>
    `<option value="${o.value}"${o.value === "PERIOD_8" ? " selected" : ""}>${o.label}</option>`
).join("\n");

const captureHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Attendance Capture — Period 8</title>
<style>
  body{font-family:Georgia,serif;background:linear-gradient(160deg,#0b1c33,#12263f);color:#f8fafc;margin:0;padding:32px}
  .card{max-width:720px;margin:0 auto;background:#0f172a;border:1px solid #d4af37;border-radius:12px;padding:24px}
  h1{color:#d4af37;margin:0 0 8px;font-size:22px}
  label{display:block;margin:12px 0 4px;color:#94a3b8;font-size:13px}
  select,button{width:100%;padding:10px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff}
  button{background:#d4af37;color:#0b1c33;font-weight:700;margin-top:16px;border:none}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
  th,td{border-bottom:1px solid #334155;padding:8px;text-align:left}
  .badge{display:inline-block;background:#14532d;color:#bbf7d0;padding:2px 8px;border-radius:999px;font-size:12px}
</style></head><body>
<div class="card">
  <h1>EduClear · Attendance Capture</h1>
  <p>Same workflow — Period 8 and Intervention appear in the existing session dropdown.</p>
  <label>Register type</label>
  <select>${optionsHtml}</select>
  <label>Classroom</label>
  <select><option>Grade 6A</option></select>
  <table>
    <tr><th>Learner</th><th>Status</th></tr>
    <tr><td>Ava Learner</td><td><span class="badge">Present (Period 8)</span></td></tr>
  </table>
  <button>Save attendance</button>
</div>
</body></html>`;
fs.writeFileSync(path.join(OUT, "attendance-capture-period8.html"), captureHtml);

const intervHtml = captureHtml
  .replace('value="PERIOD_8" selected', 'value="PERIOD_8"')
  .replace('value="INTERVENTION"', 'value="INTERVENTION" selected')
  .replace("Present (Period 8)", "Late (Intervention)")
  .replace("Period 8 and Intervention appear", "Intervention is its own session (not Period 9)");
fs.writeFileSync(path.join(OUT, "attendance-capture-intervention.html"), intervHtml);

const registerHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Weekly Period Register</title>
<style>
  body{font-family:Georgia,serif;background:#0b1c33;color:#f8fafc;margin:0;padding:24px}
  h1{color:#d4af37}
  table{border-collapse:collapse;font-size:12px;width:100%;background:#0f172a}
  th,td{border:1px solid #334155;padding:6px;text-align:center}
  th{background:#1e293b;color:#d4af37}
  .name{text-align:left;min-width:120px}
  .intv{background:#422006;color:#fdba74}
</style></head><body>
<h1>Weekly Period / Subject Register</h1>
<p>Grade 6A · 2026-08-03 to 2026-08-07 · Periods 1–8 + Intervention (separate)</p>
<table><tr><th class="name">Learner</th>
${columns.map((c) => `<th class="${c.period === "INTERVENTION" ? "intv" : ""}">${c.sessionLabel}</th>`).join("")}
</tr>
<tr><td class="name">Ava Learner</td>
${report.learners[0].cells
  .map((c, i) => `<td class="${columns[i].period === "INTERVENTION" ? "intv" : ""}">${c.abbrev}</td>`)
  .join("")}
</tr></table>
</body></html>`;
fs.writeFileSync(path.join(OUT, "weekly-period-register.html"), registerHtml);

console.log("Artifacts written to", OUT);
