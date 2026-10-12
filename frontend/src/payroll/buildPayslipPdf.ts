import { jsPDF } from "jspdf";
import {
  resolvePayslipLetterhead,
  type DaSilvaLetterhead,
  type FlyEagleLetterhead,
  type LetterheadImage,
  type LetterheadImages,
  type PayslipLetterhead,
  type PayslipLetterheadId,
} from "./payslipLetterheads";

/** Already-calculated payroll figures for one employee (no calculation happens here). */
export type PayslipPdfRow = {
  employeeName: string;
  employeeNumber: string;
  idNumber: string;
  taxNumber: string;
  jobTitle: string;
  basicSalary: number;
  overtimePay: number;
  bonus: number;
  allowances: number;
  medicalAidEmployer: number;
  gross: number;
  paye: number;
  uif: number;
  pension: number;
  medicalAidEmployee: number;
  extraDeduction: number;
  deductions: number;
  net: number;
};

export type PayslipPdfOptions = {
  period: string;
  /** Authorised school (tenant) id of the payroll record; selects the letterhead. */
  schoolId: string | null | undefined;
  /** Official artwork, keyed by letterhead — only the resolved school's entry is ever read. */
  images?: Partial<Record<PayslipLetterheadId, LetterheadImages>>;
  /** Owner-review previews only, e.g. "SAMPLE — NOT VALID FOR PAYMENT". */
  sampleLabel?: string;
};

export type PayslipPdfResult = {
  doc: jsPDF;
  letterheadId: PayslipLetterheadId | null;
  /** Every text line drawn, in order (used by tests to verify figures and branding). */
  lines: string[];
  /** Artwork drawn, as "<letterheadId>:<imageKey>[:watermark]". */
  imagesDrawn: string[];
};

const MARGIN = 16;
const FOOTER_Y = 287;
const ROW_H = 7;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function payslipMoney(v: unknown): string {
  return `R ${num(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** jsPDF core fonts are WinAnsi; map spacing characters some locales emit. */
function pdfText(value: string): string {
  return String(value ?? "").replace(/[\u202F\u2009\u2007]/g, "\u00A0");
}

export function payslipEarningsLines(row: PayslipPdfRow): Array<[string, number]> {
  return [
    ["Basic Salary", row.basicSalary],
    ["Overtime", row.overtimePay],
    ["Bonus", row.bonus],
    ["Allowances", row.allowances],
    ["Employer Medical Aid", row.medicalAidEmployer],
  ];
}

export function payslipDeductionLines(row: PayslipPdfRow): Array<[string, number]> {
  return [
    ["PAYE", row.paye],
    ["UIF", row.uif],
    ["Pension", row.pension],
    ["Medical Aid Employee", row.medicalAidEmployee],
    ["Extra Deduction", row.extraDeduction],
  ];
}

function fitImage(img: LetterheadImage, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = img.width / img.height;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

export function buildPayslipPdf(row: PayslipPdfRow, opts: PayslipPdfOptions): PayslipPdfResult {
  const letterhead = resolvePayslipLetterhead(opts.schoolId);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const lines: string[] = [];
  const imagesDrawn: string[] = [];
  const text = (value: string, x: number, y: number, o?: Parameters<jsPDF["text"]>[3]) => {
    const s = pdfText(value);
    lines.push(s);
    doc.text(s, x, y, o);
  };

  if (!letterhead) {
    drawStandardPayslip(doc, row, opts, text);
  } else {
    const images = (opts.images && opts.images[letterhead.id]) || {};
    drawBrandedPayslip(doc, row, opts, letterhead, images, text, imagesDrawn);
  }

  return { doc, letterheadId: letterhead ? letterhead.id : null, lines, imagesDrawn };
}

type TextFn = (value: string, x: number, y: number, o?: Parameters<jsPDF["text"]>[3]) => void;

/** Standard EduClear payslip (unchanged layout) for schools without an official letterhead. */
function drawStandardPayslip(doc: jsPDF, row: PayslipPdfRow, opts: PayslipPdfOptions, text: TextFn) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 32, "F");
  doc.setTextColor(212, 175, 55);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  text("EduClear Payroll", 14, 18);
  doc.setFontSize(13);
  text("PAYSLIP", pageW - 14, 18, { align: "right" });
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(14);
  text(row.employeeName, 14, 48);
  doc.setFontSize(9);
  text(`Period: ${opts.period}`, 14, 56);
  text(`Employee Number: ${row.employeeNumber}`, 14, 62);
  text(`ID Number: ${row.idNumber}`, 14, 68);
  text(`Tax Number: ${row.taxNumber}`, 14, 74);
  text(`Position: ${row.jobTitle}`, 14, 80);

  let y = 100;
  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    text(label, 18, y);
    text(value, pageW - 18, y, { align: "right" });
    y += 8;
  };
  doc.setFont("helvetica", "bold");
  text("Earnings", 18, y);
  y += 10;
  for (const [label, value] of payslipEarningsLines(row)) line(label, payslipMoney(value));
  line("Gross Earnings", payslipMoney(row.gross), true);
  y += 8;
  doc.setFont("helvetica", "bold");
  text("Deductions", 18, y);
  y += 10;
  for (const [label, value] of payslipDeductionLines(row)) line(label, payslipMoney(value));
  line("Total Deductions", payslipMoney(row.deductions), true);
  y += 10;
  doc.setFillColor(15, 23, 42);
  doc.rect(14, y, pageW - 28, 16, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  text("NET PAY", 20, y + 10);
  text(payslipMoney(row.net), pageW - 20, y + 10, { align: "right" });
  if (opts.sampleLabel) drawSampleLabel(doc, opts.sampleLabel, text);
  doc.setTextColor(140, 140, 140);
  doc.setFontSize(8);
  text("Payroll processed by EduClear", pageW / 2, 286, { align: "center" });
}

type Theme = { ink: [number, number, number]; accent: [number, number, number]; band: [number, number, number] };

const THEMES: Record<PayslipLetterheadId, Theme> = {
  "fly-eagle": { ink: [17, 17, 17], accent: [17, 17, 17], band: [17, 17, 17] },
  "da-silva": { ink: [31, 41, 55], accent: [34, 139, 58], band: [31, 41, 55] },
};

function drawBrandedPayslip(
  doc: jsPDF,
  row: PayslipPdfRow,
  opts: PayslipPdfOptions,
  letterhead: PayslipLetterhead,
  images: LetterheadImages,
  text: TextFn,
  imagesDrawn: string[]
) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const right = pageW - MARGIN;
  const theme = THEMES[letterhead.id];

  const drawPageChrome = (): number => {
    if (letterhead.id === "da-silva") drawDaSilvaWatermark(doc, images, imagesDrawn, pageW, pageH);
    const bottom =
      letterhead.id === "fly-eagle"
        ? drawFlyEagleLetterhead(doc, letterhead, images, text, imagesDrawn, pageW)
        : drawDaSilvaLetterhead(doc, letterhead, images, text, imagesDrawn, pageW);
    if (opts.sampleLabel) drawSampleLabel(doc, opts.sampleLabel, text);
    return bottom + 9;
  };

  let y = drawPageChrome();

  const ensureSpace = (needed: number, continuedTitle?: string) => {
    if (y + needed <= pageH - 24) return;
    doc.addPage("a4", "portrait");
    y = drawPageChrome();
    if (continuedTitle) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      text(`${continuedTitle} (continued)`, MARGIN, y);
      y += 6;
    }
  };

  // Title row
  doc.setTextColor(...theme.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  text("PAYSLIP", MARGIN, y);
  doc.setFontSize(11);
  text(`Pay period: ${opts.period}`, right, y, { align: "right" });
  y += 3;
  doc.setDrawColor(...theme.accent);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, MARGIN + 28, y);
  y += 6;

  // Employee details (two columns)
  const colW = (contentW - 8) / 2;
  const fieldsLeft: Array<[string, string]> = [
    ["Employee name", row.employeeName],
    ["Employee number", row.employeeNumber],
    ["Position", row.jobTitle],
  ];
  const fieldsRight: Array<[string, string]> = [
    ["ID number", row.idNumber],
    ["Tax number", row.taxNumber],
    ["Pay period", opts.period],
  ];
  const fieldBlock = (fields: Array<[string, string]>, x: number, startY: number): number => {
    let fy = startY;
    for (const [label, value] of fields) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      text(label.toUpperCase(), x, fy);
      fy += 4.2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...theme.ink);
      const wrapped = doc.splitTextToSize(pdfText(value || "—"), colW - 6) as string[];
      for (const l of wrapped) {
        text(l, x, fy);
        fy += 4.6;
      }
      fy += 2.2;
    }
    return fy;
  };
  const boxTop = y;
  const leftEnd = fieldBlock(fieldsLeft, MARGIN + 4, boxTop + 6);
  const rightEnd = fieldBlock(fieldsRight, MARGIN + colW + 12, boxTop + 6);
  const boxBottom = Math.max(leftEnd, rightEnd) - 1;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, boxTop, contentW, boxBottom - boxTop, 2, 2, "S");
  y = boxBottom + 9;

  const table = (title: string, rows: Array<[string, number]>, totalLabel: string, total: number) => {
    ensureSpace(8 + ROW_H * 2);
    doc.setFillColor(241, 245, 249);
    doc.rect(MARGIN, y - 5, contentW, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...theme.ink);
    text(title.toUpperCase(), MARGIN + 3, y);
    text("AMOUNT", right - 3, y, { align: "right" });
    y += 8;
    for (const [label, value] of rows) {
      ensureSpace(ROW_H, title);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...theme.ink);
      text(label, MARGIN + 3, y);
      text(payslipMoney(value), right - 3, y, { align: "right" });
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y + 2.4, right, y + 2.4);
      y += ROW_H;
    }
    ensureSpace(ROW_H + 2, title);
    doc.setDrawColor(...theme.ink);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y - 4.2, right, y - 4.2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    text(totalLabel, MARGIN + 3, y + 0.6);
    text(payslipMoney(total), right - 3, y + 0.6, { align: "right" });
    y += ROW_H + 5;
  };

  table("Earnings", payslipEarningsLines(row), "Gross Earnings", row.gross);
  table("Deductions", payslipDeductionLines(row), "Total Deductions", row.deductions);

  ensureSpace(20);
  doc.setFillColor(...theme.band);
  doc.rect(MARGIN, y, contentW, 15, "F");
  doc.setFillColor(...theme.accent);
  doc.rect(MARGIN, y, 2.2, 15, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  text("NET PAY", MARGIN + 7, y + 9.6);
  text(payslipMoney(row.net), right - 5, y + 9.6, { align: "right" });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    text(`${letterhead.schoolName} · Payroll processed by EduClear`, MARGIN, FOOTER_Y);
    text(`Page ${i} of ${pages}`, right, FOOTER_Y, { align: "right" });
  }
}

function drawFlyEagleLetterhead(
  doc: jsPDF,
  lh: FlyEagleLetterhead,
  images: LetterheadImages,
  text: TextFn,
  imagesDrawn: string[],
  pageW: number
): number {
  const right = pageW - MARGIN;
  const crestBox = 30;
  const crestX = pageW / 2 - crestBox / 2;
  const crestY = 10;
  if (images.crest) {
    const { w, h } = fitImage(images.crest, crestBox, crestBox);
    doc.addImage(images.crest.dataUrl, images.crest.format, pageW / 2 - w / 2, crestY + (crestBox - h) / 2, w, h, "fly-eagle-crest", "FAST");
    imagesDrawn.push("fly-eagle:crest");
  } else {
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.rect(crestX, crestY, crestBox, crestBox, "S");
    doc.setLineDashPattern([], 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    text("OFFICIAL CREST", pageW / 2, crestY + 13.5, { align: "center" });
    text("ARTWORK REQUIRED", pageW / 2, crestY + 17, { align: "center" });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(17, 17, 17);
  let ly = 14;
  for (const l of lh.leftLines) {
    text(l, MARGIN, ly);
    ly += 4.4;
  }
  let ry = 14;
  for (const l of lh.rightLines) {
    text(l, right, ry, { align: "right" });
    ry += 4.4;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(17, 17, 17);
  text(lh.schoolName.toUpperCase(), pageW / 2, 48, { align: "center" });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  text(lh.motto, pageW / 2, 54, { align: "center" });

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.9);
  doc.line(MARGIN, 58, right, 58);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, 59.6, right, 59.6);
  return 59.6;
}

function drawDaSilvaLetterhead(
  doc: jsPDF,
  lh: DaSilvaLetterhead,
  images: LetterheadImages,
  text: TextFn,
  imagesDrawn: string[],
  pageW: number
): number {
  const right = pageW - MARGIN;
  if (images.crest) {
    const { w, h } = fitImage(images.crest, 26, 36);
    doc.addImage(images.crest.dataUrl, images.crest.format, right - w, 9, w, h, "da-silva-crest", "FAST");
    imagesDrawn.push("da-silva:crest");
  }
  let y: number;
  if (images.heading) {
    const { w, h } = fitImage(images.heading, 86, 26);
    doc.addImage(images.heading.dataUrl, images.heading.format, MARGIN - 1, 11, w, h, "da-silva-heading", "FAST");
    imagesDrawn.push("da-silva:heading");
    y = 11 + h + 3;
  } else {
    doc.setFont("times", "bolditalic");
    doc.setFontSize(24);
    doc.setTextColor(31, 41, 55);
    text(lh.schoolName, MARGIN, 26);
    y = 32;
  }
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.setTextColor(34, 139, 58);
  text(`“${lh.motto}”`, MARGIN + 2, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(55, 65, 81);
  for (const l of lh.contactLines) {
    text(l, MARGIN + 2, y);
    y += 4.2;
  }
  const divider = Math.max(y, 47);
  doc.setDrawColor(34, 139, 58);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, divider, right, divider);
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, divider + 1.2, right, divider + 1.2);
  return divider + 1.2;
}

function drawDaSilvaWatermark(
  doc: jsPDF,
  images: LetterheadImages,
  imagesDrawn: string[],
  pageW: number,
  pageH: number
) {
  if (!images.crest) return;
  const { w, h } = fitImage(images.crest, 130, 170);
  doc.saveGraphicsState();
  doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.07 }));
  doc.addImage(images.crest.dataUrl, images.crest.format, pageW / 2 - w / 2, (pageH - h) / 2 + 22, w, h, "da-silva-crest", "FAST");
  doc.restoreGraphicsState();
  imagesDrawn.push("da-silva:crest:watermark");
}

function drawSampleLabel(doc: jsPDF, label: string, text: TextFn) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.13 }));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.setTextColor(185, 28, 28);
  const angle = 52;
  const rad = (angle * Math.PI) / 180;
  const half = doc.getTextWidth(pdfText(label)) / 2;
  text(label, pageW / 2 - half * Math.cos(rad), pageH / 2 + half * Math.sin(rad), { angle });
  doc.restoreGraphicsState();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(185, 28, 28);
  text(label, pageW / 2, 6, { align: "center" });
}
