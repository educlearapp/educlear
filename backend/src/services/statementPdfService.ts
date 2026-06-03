import PDFDocument from "pdfkit";
import { loadSchoolLogoBuffer } from "../utils/schoolLogo";
import type { StatementPdfInput } from "./statementPdfTypes";

const INK = "#111827";
const MUTED = "#6b7280";
const GOLD = "#d4af37";
const TABLE_HEAD = "#111827";
const ROW_ALT = "#faf8f0";
const ROW_BORDER = "#e5e7eb";
const CARD_FILL = "#fafafa";

const STATEMENT_LOGO_MAX_PT = 48;
const STATEMENT_LOGO_GAP_PT = 6;
/** ~12.7 mm side margins on A4 portrait */
const PAGE_MARGIN_PT = 36;
const FOOTER_RESERVE_PT = 88;
const TABLE_ROW_MIN_PT = 16;
const TABLE_ROW_PAD_PT = 4;
const TABLE_HEADER_H_PT = 18;
const SCHOOL_NAME_FONT_SIZE = 13;
const CONTACT_FONT_SIZE = 8;
const SCHOOL_NAME_LINE_GAP_PT = 6;
const CONTACT_LINE_GAP_PT = 4;
const CARD_PAD_PT = 10;
const CARD_TITLE_GAP_PT = 14;
const CARD_LINE_GAP_PT = 5;

function formatMoney(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBalance(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatMoney(value);
}

function splitNonEmptyLines(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function schoolHeaderContactLines(school: StatementPdfInput["school"]): string[] {
  const lines: string[] = [];
  lines.push(...splitNonEmptyLines(school.address));
  const postal = splitNonEmptyLines(school.postalAddress);
  const physicalKey = lines.join("|");
  const postalKey = postal.join("|");
  if (postal.length && postalKey !== physicalKey) {
    lines.push(...postal);
  }
  if (school.phone) lines.push(`Tel: ${school.phone}`);
  if (school.cellNo) lines.push(`Cell: ${school.cellNo}`);
  if (school.email) lines.push(String(school.email));
  return lines;
}

function drawStackedTextLine(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  x: number,
  y: number,
  width: number,
  gapAfter: number,
  options?: { font?: string; fontSize?: number; color?: string; bold?: boolean }
): number {
  if (options?.bold) doc.font("Helvetica-Bold");
  else doc.font(options?.font || "Helvetica");
  if (options?.fontSize) doc.fontSize(options.fontSize);
  if (options?.color) doc.fillColor(options.color);
  const h = doc.heightOfString(text, { width, lineGap: 1 });
  doc.text(text, x, y, { width, lineGap: 1 });
  return y + h + gapAfter;
}

function measureStackedLines(
  doc: InstanceType<typeof PDFDocument>,
  lines: string[],
  width: number,
  gapAfter: number,
  fontSize = 8.5
): number {
  doc.font("Helvetica").fontSize(fontSize);
  let h = 0;
  for (const line of lines) {
    h += doc.heightOfString(line, { width, lineGap: 1 }) + gapAfter;
  }
  return h;
}

function sanitizeFilename(filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").trim();
  return safe.endsWith(".pdf") ? safe : `${safe || "statement"}.pdf`;
}

import { buildStatementPdfFilename } from "../utils/statementPeriod";

export function statementPdfFilename(accountNo: string, period?: string): string {
  return sanitizeFilename(buildStatementPdfFilename(accountNo, period || "All Time"));
}

type ColLayout = { headers: string[]; colWidths: number[] };

function buildColumnLayout(contentW: number, isFamilyAccount: boolean): ColLayout {
  if (isFamilyAccount) {
    const fixed = [42, 38, 58, 52, 50, 50, 58];
    const fixedSum = fixed.reduce((s, w) => s + w, 0);
    const descW = Math.max(80, contentW - fixedSum);
    return {
      headers: ["Date", "Type", "Learner", "Reference", "Description", "Amount In", "Amount Out", "Running Balance"],
      colWidths: [42, 38, 58, 52, descW, 50, 50, 58],
    };
  }
  const fixed = [46, 40, 58, 50, 50, 58];
  const fixedSum = fixed.reduce((s, w) => s + w, 0);
  const descW = Math.max(90, contentW - fixedSum);
  return {
    headers: ["Date", "Type", "Reference", "Description", "Amount In", "Amount Out", "Running Balance"],
    colWidths: [46, 40, 58, descW, 50, 50, 58],
  };
}

function drawTableHeader(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  colWidths: number[],
  x0: number,
  y: number
): number {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  doc.save();
  doc.rect(x0, y, totalW, TABLE_HEADER_H_PT).fill(TABLE_HEAD);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7);
  let x = x0 + 4;
  headers.forEach((label, i) => {
    const w = colWidths[i];
    const alignRight = i >= headers.length - 3;
    doc.text(label, alignRight ? x + w - 4 : x, y + 5, {
      width: w - 8,
      align: alignRight ? "right" : "left",
      lineGap: 0,
    });
    x += w;
  });
  doc.restore();
  return y + TABLE_HEADER_H_PT;
}

function measureRowHeight(
  doc: InstanceType<typeof PDFDocument>,
  values: string[],
  colWidths: number[]
): number {
  doc.font("Helvetica").fontSize(7);
  let maxH = TABLE_ROW_MIN_PT;
  values.forEach((value, i) => {
    const w = Math.max(12, colWidths[i] - 8);
    const h = doc.heightOfString(String(value || "—"), { width: w, lineGap: 1 });
    maxH = Math.max(maxH, h + TABLE_ROW_PAD_PT * 2);
  });
  return maxH;
}

function drawTableRow(
  doc: InstanceType<typeof PDFDocument>,
  values: string[],
  colWidths: number[],
  x0: number,
  y: number,
  rowH: number,
  shaded: boolean
) {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  if (shaded) {
    doc.save();
    doc.rect(x0, y, totalW, rowH).fill(ROW_ALT);
    doc.restore();
  }
  doc.strokeColor(ROW_BORDER).moveTo(x0, y + rowH).lineTo(x0 + totalW, y + rowH).stroke();
  doc.fillColor(INK).font("Helvetica").fontSize(7);
  let x = x0 + 4;
  values.forEach((value, i) => {
    const w = colWidths[i];
    const alignRight = i >= values.length - 3;
    const innerW = Math.max(12, w - 8);
    doc.text(String(value || "—"), alignRight ? x + w - 4 - innerW : x, y + TABLE_ROW_PAD_PT, {
      width: innerW,
      align: alignRight ? "right" : "left",
      lineGap: 1,
    });
    x += w;
  });
}

function accountCardLines(input: StatementPdfInput): string[] {
  const lines: string[] = [`Family account: ${input.accountLabel}`];
  const showLearnersList = input.isFamilyAccount || input.children.length > 1;
  if (showLearnersList) {
    lines.push("All learners / siblings:");
    for (const child of input.children) {
      lines.push(`• ${child.name} — Grade ${child.grade}`);
    }
  } else if (input.children.length === 1) {
    const child = input.children[0];
    lines.push(`• ${child.name} — Grade ${child.grade}`);
  }
  return lines;
}

function contactCardLines(input: StatementPdfInput): string[] {
  const contactName = input.contact?.name || input.accountLabel;
  const contactEmail = input.contact?.email || "—";
  const contactCell = input.contact?.cellphone || "—";
  const contactRel = input.contact?.relationship || "Parent";
  const contactAccountNo = input.contact?.accountNo || input.accountNo || "—";
  return [
    `Parent/guardian: ${contactName}`,
    `Email: ${contactEmail}`,
    `Cell: ${contactCell}`,
    `Relationship: ${contactRel}`,
    `Account no: ${contactAccountNo}`,
  ];
}

function measureCardHeight(
  doc: InstanceType<typeof PDFDocument>,
  lines: string[],
  innerW: number
): number {
  doc.font("Helvetica-Bold").fontSize(8);
  let h = CARD_PAD_PT + 10 + CARD_TITLE_GAP_PT;
  h += measureStackedLines(doc, lines, innerW, CARD_LINE_GAP_PT, 8.5);
  return h + CARD_PAD_PT;
}

function drawInfoCard(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number
) {
  doc.save();
  doc.roundedRect(x, y, width, height, 4).fill(CARD_FILL).strokeColor(ROW_BORDER).stroke();
  doc.restore();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(8);
  doc.text(title, x + CARD_PAD_PT, y + CARD_PAD_PT);
  let lineY = y + CARD_PAD_PT + CARD_TITLE_GAP_PT;
  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  const innerW = width - CARD_PAD_PT * 2;
  for (const line of lines) {
    lineY = drawStackedTextLine(doc, line, x + CARD_PAD_PT, lineY, innerW, CARD_LINE_GAP_PT);
  }
}

type PageLayout = {
  pageW: number;
  pageH: number;
  margin: number;
  contentW: number;
  bottomLimit: number;
};

/**
 * Generates a valid PDF buffer (%PDF header) for account statements.
 */
export async function generateStatementPdfBuffer(input: StatementPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  const chunks: Buffer[] = [];

  const layout: PageLayout = {
    pageW: doc.page.width,
    pageH: doc.page.height,
    margin: PAGE_MARGIN_PT,
    contentW: doc.page.width - PAGE_MARGIN_PT * 2,
    bottomLimit: doc.page.height - PAGE_MARGIN_PT - FOOTER_RESERVE_PT,
  };

  const { headers, colWidths } = buildColumnLayout(layout.contentW, input.isFamilyAccount);
  const leftW = layout.contentW * 0.55;
  const rightW = layout.contentW - leftW - 12;
  const leftX = layout.margin;
  const rightX = layout.margin + leftW + 12;

  let y = layout.margin;

  const logoBuf = await loadSchoolLogoBuffer(input.school.logoUrl);

  const drawCompactContinuationHeader = () => {
    const schoolName = String(input.school.name || "School").trim() || "School";
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(schoolName, leftX, y, { width: layout.contentW * 0.6 });
    doc.text("STATEMENT (continued)", rightX, y, { width: rightW, align: "right" });
    y += 16;
    doc.strokeColor(GOLD).lineWidth(0.75).moveTo(layout.margin, y).lineTo(layout.pageW - layout.margin, y).stroke();
    y += 10;
    y = drawTableHeader(doc, headers, colWidths, layout.margin, y);
  };

  const drawFullHeader = () => {
    let leftY = layout.margin;
    let rightY = layout.margin;

    if (logoBuf) {
      try {
        doc.image(logoBuf, leftX, leftY, { fit: [STATEMENT_LOGO_MAX_PT, STATEMENT_LOGO_MAX_PT] });
        leftY += STATEMENT_LOGO_MAX_PT + STATEMENT_LOGO_GAP_PT;
      } catch (err) {
        console.warn("[statement-pdf] school logo embed failed:", err);
      }
    }

    const schoolName = String(input.school.name || "School").trim() || "School";
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(SCHOOL_NAME_FONT_SIZE);
    leftY = drawStackedTextLine(doc, schoolName, leftX, leftY, leftW, SCHOOL_NAME_LINE_GAP_PT, { bold: true });

    doc.font("Helvetica").fontSize(CONTACT_FONT_SIZE).fillColor(MUTED);
    for (const line of schoolHeaderContactLines(input.school)) {
      leftY = drawStackedTextLine(doc, line, leftX, leftY, leftW, CONTACT_LINE_GAP_PT, { color: MUTED });
    }

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(18);
    doc.text("STATEMENT", rightX, rightY, { width: rightW, align: "right" });
    rightY += 24;

    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    doc.text(`Account number: ${input.accountNo}`, rightX, rightY, { width: rightW, align: "right" });
    rightY += 11;
    doc.text(`Statement period: ${input.period}`, rightX, rightY, { width: rightW, align: "right" });
    rightY += 11;
    doc.text(`Statement date: ${input.statementDate}`, rightX, rightY, { width: rightW, align: "right" });
    rightY += 11;

    y = Math.max(leftY, rightY) + 12;
    doc.strokeColor(GOLD).lineWidth(1).moveTo(layout.margin, y).lineTo(layout.pageW - layout.margin, y).stroke();
    y += 14;
  };

  const ensureSpace = (needed: number, repeatTableHeader = true) => {
    if (y + needed <= layout.bottomLimit) return;
    doc.addPage();
    y = layout.margin;
    if (repeatTableHeader) {
      drawCompactContinuationHeader();
    }
  };

  drawFullHeader();

  const boxGap = 12;
  const boxW = (layout.contentW - boxGap) / 2;
  const accountLines = accountCardLines(input);
  const contactLines = contactCardLines(input);
  const innerCardW = boxW - CARD_PAD_PT * 2;
  const boxH = Math.max(
    measureCardHeight(doc, accountLines, innerCardW),
    measureCardHeight(doc, contactLines, innerCardW)
  );

  ensureSpace(boxH + 16, false);
  drawInfoCard(doc, "ACCOUNT", accountLines, layout.margin, y, boxW, boxH);
  drawInfoCard(doc, "CONTACT", contactLines, layout.margin + boxW + boxGap, y, boxW, boxH);
  y += boxH + 16;

  y = drawTableHeader(doc, headers, colWidths, layout.margin, y);

  const transactions = input.transactions || [];
  if (!transactions.length) {
    ensureSpace(TABLE_ROW_MIN_PT + 8);
    const emptyH = TABLE_ROW_MIN_PT + 6;
    doc.strokeColor(ROW_BORDER).rect(layout.margin, y, layout.contentW, emptyH).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text("No transactions for the selected period.", layout.margin, y + 6, {
      width: layout.contentW,
      align: "center",
    });
    y += emptyH + 8;
  } else {
    transactions.forEach((row, index) => {
      const values = input.isFamilyAccount
        ? [
            row.date,
            row.type,
            row.learner || "—",
            row.reference,
            row.description,
            row.amountIn ? formatMoney(row.amountIn) : "—",
            row.amountOut ? formatMoney(row.amountOut) : "—",
            formatBalance(row.balance),
          ]
        : [
            row.date,
            row.type,
            row.reference,
            row.description,
            row.amountIn ? formatMoney(row.amountIn) : "—",
            row.amountOut ? formatMoney(row.amountOut) : "—",
            formatBalance(row.balance),
          ];

      const rowH = measureRowHeight(doc, values, colWidths);
      ensureSpace(rowH + 2);
      drawTableRow(doc, values, colWidths, layout.margin, y, rowH, index % 2 === 1);
      y += rowH;
    });
  }

  const closingCardH = 40;
  const closingGap = 12;
  ensureSpace(closingCardH + closingGap + 20, false);

  y += closingGap;
  const totalW = Math.min(220, layout.contentW * 0.45);
  const totalX = layout.pageW - layout.margin - totalW;
  doc.save();
  doc.roundedRect(totalX, y, totalW, closingCardH, 4).fill("#fff8e6").strokeColor(GOLD).lineWidth(1.25).stroke();
  doc.restore();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
  doc.text("Closing balance", totalX + 10, y + 14);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#991b1b");
  doc.text(formatMoney(input.balance), totalX + 10, y + 14, { width: totalW - 20, align: "right" });
  y += closingCardH + 16;

  if (input.statementNote) {
    ensureSpace(36, false);
    doc.fillColor(INK).font("Helvetica").fontSize(8.5);
    const noteH = doc.heightOfString(input.statementNote, { width: layout.contentW, lineGap: 1 });
    doc.text(input.statementNote, layout.margin, y, { width: layout.contentW, lineGap: 1 });
    y += noteH + 12;
  }

  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(
    `Statement generated for ${input.school.name || "School"} via EduClear.`,
    layout.margin,
    layout.pageH - layout.margin - 10,
    { width: layout.contentW, align: "center" }
  );

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
