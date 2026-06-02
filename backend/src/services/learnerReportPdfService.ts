import PDFDocument from "pdfkit";
import { loadSchoolLogoBuffer } from "../utils/schoolLogo";
import type { LearnerReportPdfInput } from "./learnerReportPdfTypes";

const INK = "#111827";
const MUTED = "#6b7280";
const GOLD = "#d4af37";
const ROW_ALT = "#faf8f0";
const ROW_BORDER = "#e5e7eb";
const PAGE_MARGIN = 40;
const LOGO_MAX = 48;

function drawLine(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  x: number,
  y: number,
  width: number,
  gap: number
): number {
  const h = doc.heightOfString(text, { width });
  doc.text(text, x, y, { width, lineGap: 1 });
  return y + h + gap;
}

export async function generateLearnerReportPdfBuffer(input: LearnerReportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: PAGE_MARGIN });
  const chunks: Buffer[] = [];

  const contentW = doc.page.width - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  const logoBuf = await loadSchoolLogoBuffer(input.school.logoUrl);
  if (logoBuf) {
    try {
      doc.image(logoBuf, PAGE_MARGIN, y, { fit: [LOGO_MAX, LOGO_MAX] });
      y += LOGO_MAX + 8;
    } catch (err) {
      console.warn("[learner-report-pdf] logo embed failed:", err);
    }
  }

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(14);
  y = drawLine(doc, input.school.name, PAGE_MARGIN, y, contentW, 6);

  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  if (input.school.address) y = drawLine(doc, input.school.address, PAGE_MARGIN, y, contentW, 4);
  if (input.school.phone) y = drawLine(doc, `Tel: ${input.school.phone}`, PAGE_MARGIN, y, contentW, 4);
  if (input.school.email) y = drawLine(doc, input.school.email, PAGE_MARGIN, y, contentW, 8);

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18);
  y = drawLine(doc, "LEARNER PROGRESS REPORT", PAGE_MARGIN, y, contentW, 10);

  doc.strokeColor(GOLD).lineWidth(1.5).moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + contentW, y).stroke();
  y += 14;

  const learnerName = `${input.learner.firstName} ${input.learner.lastName}`.trim() || "Learner";
  const classLabel = input.learner.className || input.learner.grade || "—";

  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
  y = drawLine(doc, `Learner: ${learnerName}`, PAGE_MARGIN, y, contentW, 6);
  y = drawLine(doc, `Class: ${classLabel}`, PAGE_MARGIN, y, contentW, 6);
  y = drawLine(doc, `Term: ${input.term}`, PAGE_MARGIN, y, contentW, 6);
  y = drawLine(doc, `Report date: ${input.reportDate}`, PAGE_MARGIN, y, contentW, 12);

  if (input.overallAverage != null) {
    y = drawLine(doc, `Overall average: ${input.overallAverage}%`, PAGE_MARGIN, y, contentW, 6);
  }
  if (input.attendancePercent != null) {
    y = drawLine(doc, `Attendance: ${input.attendancePercent}%`, PAGE_MARGIN, y, contentW, 10);
  }

  const colW = [contentW * 0.34, contentW * 0.14, contentW * 0.52];
  const rowH = 22;
  const headers = ["Subject", "Mark", "Comment"];

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  doc.rect(PAGE_MARGIN, y, contentW, rowH).fill(INK);
  let x = PAGE_MARGIN + 6;
  for (let i = 0; i < headers.length; i++) {
    doc.fillColor("#ffffff").text(headers[i], x, y + 6, { width: colW[i] - 8 });
    x += colW[i];
  }
  y += rowH;

  doc.font("Helvetica").fontSize(8.5);
  input.subjects.forEach((row, idx) => {
    if (y > doc.page.height - PAGE_MARGIN - 80) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    const bg = idx % 2 === 0 ? "#ffffff" : ROW_ALT;
    doc.rect(PAGE_MARGIN, y, contentW, rowH).fill(bg).strokeColor(ROW_BORDER).stroke();
    x = PAGE_MARGIN + 6;
    doc.fillColor(INK).text(row.subject, x, y + 6, { width: colW[0] - 8 });
    x += colW[0];
    doc.text(row.scoreText, x, y + 6, { width: colW[1] - 8 });
    x += colW[1];
    doc.fillColor(MUTED).text(row.comment, x, y + 6, { width: colW[2] - 8 });
    y += rowH;
  });

  y += 12;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9);
  if (input.classTeacherRemark) {
    y = drawLine(doc, "Class teacher remark:", PAGE_MARGIN, y, contentW, 4);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    y = drawLine(doc, input.classTeacherRemark, PAGE_MARGIN, y, contentW, 10);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
  }
  if (input.principalRemark) {
    y = drawLine(doc, "Principal remark:", PAGE_MARGIN, y, contentW, 4);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    y = drawLine(doc, input.principalRemark, PAGE_MARGIN, y, contentW, 8);
  }

  return new Promise((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {
      const buffer = Buffer.concat(chunks);
      if (!buffer.subarray(0, 5).toString("utf8").startsWith("%PDF")) {
        reject(new Error("PDF generation failed"));
        return;
      }
      resolve(buffer);
    });
    doc.on("error", reject);
    doc.end();
  });
}

export async function buildAndGenerateLearnerReportPdf(opts: {
  schoolId: string;
  learnerId: string;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { buildLearnerReportPdfInput, learnerReportPdfFilename } = await import("./learnerReportPdfData");
  const input = await buildLearnerReportPdfInput(opts.schoolId, opts.learnerId);
  if (!input) {
    throw new Error("Learner or school not found for report generation.");
  }
  const buffer = await generateLearnerReportPdfBuffer(input);
  const filename = learnerReportPdfFilename(input.learner.firstName, input.learner.lastName);
  return { buffer, filename };
}
