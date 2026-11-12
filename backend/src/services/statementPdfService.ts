import PDFDocument from "pdfkit";
import { loadSchoolLogoBuffer } from "../utils/schoolLogo";
import { buildStatementPdfFilename } from "../utils/statementPeriod";
import {
  formatStatementAmountCell,
  formatStatementBalanceCell,
  formatStatementSignedMoney,
  normaliseStatementNumber,
  signedStatementAmount,
} from "./statementAmountFormat";
import type { StatementPdfInput, StatementPdfTransaction } from "./statementPdfTypes";

const INK = "#111827";
const MUTED = "#4b5563";
const LINE = "#d1d5db";
const TABLE_HEAD = "#111827";
const ROW_ALT = "#f9fafb";
const ROW_BORDER = "#e5e7eb";

const STATEMENT_LOGO_MAX_PT = 48;
const STATEMENT_LOGO_GAP_PT = 4;
/** ~12 mm side margins on A4 portrait */
const PAGE_MARGIN_PT = 32;
const TABLE_ROW_MIN_PT = 10;
const TABLE_ROW_PAD_PT = 2;
const TABLE_HEADER_H_PT = 12;
const TABLE_FONT_SIZE = 8;
const SCHOOL_NAME_FONT_SIZE = 13;
const STATEMENT_TITLE_FONT_SIZE = 16;
const CONTACT_FONT_SIZE = 8;
const META_FONT_SIZE = 9;
const FOOTER_BANKING_FONT = 7.5;
const FOOTER_PAGE_FONT = 8;

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

function bankingFooterLines(school: StatementPdfInput["school"]): string[] {
  return splitNonEmptyLines(school.bankingDetails);
}

function sanitizeFilename(filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").trim();
  return safe.endsWith(".pdf") ? safe : `${safe || "statement"}.pdf`;
}

export function statementPdfFilename(accountNo: string, period?: string): string {
  return sanitizeFilename(buildStatementPdfFilename(accountNo, period || "All Time"));
}

type ColLayout = { headers: string[]; colWidths: number[] };

function buildColumnLayout(contentW: number): ColLayout {
  // Date | Type | Ref | Description | Amount | Balance
  const fixed = [54, 68, 58, 60, 60];
  const fixedSum = fixed.reduce((s, w) => s + w, 0);
  const descW = Math.max(110, contentW - fixedSum);
  return {
    headers: ["Date", "Type", "Ref", "Description", "Amount", "Balance"],
    colWidths: [54, 68, 58, descW, 60, 60],
  };
}

function drawStackedTextLine(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  x: number,
  y: number,
  width: number,
  gapAfter: number,
  options?: { fontSize?: number; color?: string; bold?: boolean; align?: "left" | "right" }
): number {
  if (options?.bold) doc.font("Helvetica-Bold");
  else doc.font("Helvetica");
  if (options?.fontSize) doc.fontSize(options.fontSize);
  if (options?.color) doc.fillColor(options.color);
  const h = doc.heightOfString(text, { width, lineGap: 1, align: options?.align || "left" });
  doc.text(text, x, y, { width, lineGap: 1, align: options?.align || "left" });
  return y + h + gapAfter;
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
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(TABLE_FONT_SIZE);
  let x = x0 + 2;
  headers.forEach((label, i) => {
    const w = colWidths[i];
    const alignRight = i >= headers.length - 2;
    doc.text(label, x, y + 2.5, {
      width: w - 4,
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
  doc.font("Helvetica").fontSize(TABLE_FONT_SIZE);
  let maxH = TABLE_ROW_MIN_PT;
  values.forEach((value, i) => {
    const w = Math.max(10, colWidths[i] - 6);
    const h = doc.heightOfString(String(value || ""), { width: w, lineGap: 0 });
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
  shaded: boolean,
  options?: { bold?: boolean }
) {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  if (shaded) {
    doc.save();
    doc.rect(x0, y, totalW, rowH).fill(ROW_ALT);
    doc.restore();
  }
  doc.strokeColor(ROW_BORDER).lineWidth(0.5).moveTo(x0, y + rowH).lineTo(x0 + totalW, y + rowH).stroke();
  if (options?.bold) doc.font("Helvetica-Bold");
  else doc.font("Helvetica");
  doc.fillColor(INK).fontSize(TABLE_FONT_SIZE);
  let x = x0 + 3;
  values.forEach((value, i) => {
    const w = colWidths[i];
    const alignRight = i >= values.length - 2;
    const innerW = Math.max(10, w - 6);
    doc.text(String(value || ""), x, y + TABLE_ROW_PAD_PT, {
      width: innerW,
      align: alignRight ? "right" : "left",
      lineGap: 0,
    });
    x += w;
  });
}

function transactionSortTime(row: StatementPdfTransaction): number {
  const t = new Date(row.date || "").getTime();
  return Number.isNaN(t) ? 0 : t;
}

type DisplayRow = {
  date: string;
  type: string;
  reference: string;
  description: string;
  amount: number | null;
  balance: number | null;
  bold?: boolean;
};

/**
 * Presentation-only display rows (Kid-e-Sys layout).
 * Uses amounts/balances already produced by the production statement builder.
 * Does not recalculate running or closing balances. Null builder balances stay blank.
 */
function statementSectionOrder(
  section: StatementPdfTransaction["statementSection"] | undefined
): number {
  if (section === "historical") return 0;
  if (section === "brought-forward") return 1;
  if (section === "active") return 2;
  // Legacy rows without section keep date-only ordering (same bucket).
  return 1;
}

export function buildStatementDisplayRows(input: StatementPdfInput): DisplayRow[] {
  const opening = normaliseStatementNumber(input.openingBalance ?? 0);
  const chronological = [...(input.transactions || [])].sort((a, b) => {
    const sectionDelta =
      statementSectionOrder(a.statementSection) - statementSectionOrder(b.statementSection);
    if (sectionDelta !== 0) return sectionDelta;
    if (a.chronoSeq != null && b.chronoSeq != null && a.chronoSeq !== b.chronoSeq) {
      return a.chronoSeq - b.chronoSeq;
    }
    const dt = transactionSortTime(a) - transactionSortTime(b);
    if (dt !== 0) return dt;
    return String(a.reference || "").localeCompare(String(b.reference || ""));
  });

  const rows: DisplayRow[] = [];
  if (input.includeBroughtForward) {
    rows.push({
      date: "",
      type: "",
      reference: "",
      description: input.broughtForwardLabel || "Balance Brought Forward",
      amount: null,
      balance: opening,
      bold: true,
    });
  }

  for (const row of chronological) {
    const signed = signedStatementAmount(row.amountIn, row.amountOut);
    const isBroughtForward = row.statementSection === "brought-forward";
    if (row.balance === null || row.balance === undefined) {
      rows.push({
        date: row.date || "",
        type: row.type || "",
        reference: row.reference || "",
        description: row.description || "",
        amount: signed,
        balance: null,
        ...(isBroughtForward ? { bold: true } : {}),
      });
      continue;
    }
    rows.push({
      date: row.date || "",
      type: row.type || "",
      reference: row.reference || "",
      description: row.description || "",
      amount: signed,
      balance: normaliseStatementNumber(row.balance),
      ...(isBroughtForward ? { bold: true } : {}),
    });
  }
  return rows;
}

function measureFooterReserve(bankingLines: string[]): number {
  const bankingBlock = bankingLines.length ? 10 + bankingLines.length * 9 + 6 : 8;
  return Math.max(42, bankingBlock + 18);
}

type PageLayout = {
  pageW: number;
  pageH: number;
  margin: number;
  contentW: number;
  bottomLimit: number;
};

/**
 * PDFKit runtime exposes openImage() for reusable image XObjects, but @types/pdfkit
 * only types image(). Keep a narrow local type so bulk PDFs embed the logo once.
 */
type PdfKitImageHandle = object;
type PdfKitDocWithOpenImage = InstanceType<typeof PDFDocument> & {
  openImage: (src: Buffer | string) => PdfKitImageHandle;
};

function openPdfKitImage(
  doc: InstanceType<typeof PDFDocument>,
  src: Buffer
): PdfKitImageHandle | null {
  const openImage = (doc as PdfKitDocWithOpenImage).openImage;
  if (typeof openImage !== "function") return null;
  try {
    return openImage.call(doc, src);
  } catch (err) {
    console.warn("[statement-pdf] school logo openImage failed:", err);
    return null;
  }
}

function finalizePdfDocument(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  const chunks: Buffer[] = [];
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

/**
 * Draws one family statement into an existing PDFKit document (Kid-e-Sys layout).
 * Callers must position on a fresh page. Pass a shared openImage() handle so bulk
 * PDFs embed the school logo once (production performance path preserved).
 */
export function drawStatementOntoDocument(
  doc: InstanceType<typeof PDFDocument>,
  input: StatementPdfInput,
  opts?: { logoImage?: PdfKitImageHandle | null; logoBuffer?: Buffer | null }
): { startPageIndex: number; endPageIndex: number } {
  const pageRangeBefore = typeof doc.bufferedPageRange === "function" ? doc.bufferedPageRange() : null;
  const startIndex = pageRangeBefore
    ? pageRangeBefore.start + pageRangeBefore.count - 1
    : 0;

  const bankingLines = bankingFooterLines(input.school);
  const footerReserve = measureFooterReserve(bankingLines);

  const layout: PageLayout = {
    pageW: doc.page.width,
    pageH: doc.page.height,
    margin: PAGE_MARGIN_PT,
    contentW: doc.page.width - PAGE_MARGIN_PT * 2,
    bottomLimit: doc.page.height - PAGE_MARGIN_PT - footerReserve,
  };

  const { headers, colWidths } = buildColumnLayout(layout.contentW);
  const leftW = layout.contentW * 0.58;
  const rightW = layout.contentW - leftW - 10;
  const leftX = layout.margin;
  const rightX = layout.margin + leftW + 10;

  let y = layout.margin;
  const firstPageIndexForFooter = startIndex;

  let logoImage: PdfKitImageHandle | null = opts?.logoImage ?? null;
  if (!logoImage && opts?.logoBuffer) {
    logoImage = openPdfKitImage(doc, opts.logoBuffer);
  }

  const drawTableHead = () => {
    y = drawTableHeader(doc, headers, colWidths, layout.margin, y);
  };

  const drawContinuationHeader = () => {
    const schoolName = String(input.school.name || "School").trim() || "School";
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(schoolName, leftX, y, { width: layout.contentW * 0.55 });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    doc.text("Statement (continued)", rightX, y, { width: rightW, align: "right" });
    y += 14;
    doc.strokeColor(LINE).lineWidth(0.75).moveTo(layout.margin, y).lineTo(layout.pageW - layout.margin, y).stroke();
    y += 8;
    drawTableHead();
  };

  const drawFullHeader = () => {
    let leftY = layout.margin;
    let rightY = layout.margin;

    if (logoImage || opts?.logoBuffer) {
      try {
        doc.image((logoImage || opts?.logoBuffer) as Buffer, leftX, leftY, {
          fit: [STATEMENT_LOGO_MAX_PT, STATEMENT_LOGO_MAX_PT],
        });
        leftY += STATEMENT_LOGO_MAX_PT + STATEMENT_LOGO_GAP_PT;
      } catch (err) {
        console.warn("[statement-pdf] school logo embed failed:", err);
      }
    }

    const schoolName = String(input.school.name || "School").trim() || "School";
    leftY = drawStackedTextLine(doc, schoolName, leftX, leftY, leftW, 4, {
      bold: true,
      fontSize: SCHOOL_NAME_FONT_SIZE,
      color: INK,
    });

    doc.font("Helvetica").fontSize(CONTACT_FONT_SIZE).fillColor(MUTED);
    for (const line of schoolHeaderContactLines(input.school)) {
      rightY = drawStackedTextLine(doc, line, rightX, rightY, rightW, 2, {
        fontSize: CONTACT_FONT_SIZE,
        color: MUTED,
        align: "right",
      });
    }

    y = Math.max(leftY, rightY) + 8;
    doc.strokeColor(LINE).lineWidth(1).moveTo(layout.margin, y).lineTo(layout.pageW - layout.margin, y).stroke();
    y += 10;

    y = drawStackedTextLine(doc, "Statement", layout.margin, y, layout.contentW, 8, {
      bold: true,
      fontSize: STATEMENT_TITLE_FONT_SIZE,
      color: INK,
    });

    const contactName = input.contact?.name || input.accountLabel || "—";
    const metaLines: string[] = [
      `Parent / Guardian: ${contactName}`,
      `Account number: ${input.accountNo}`,
      `Statement date: ${input.statementDate}`,
      `Period: ${input.period}`,
    ];
    doc.font("Helvetica").fontSize(META_FONT_SIZE).fillColor(INK);
    for (const line of metaLines) {
      y = drawStackedTextLine(doc, line, layout.margin, y, layout.contentW, 3, {
        fontSize: META_FONT_SIZE,
        color: INK,
      });
    }
    y += 4;

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9);
    doc.text("Learners", layout.margin, y);
    y += 12;
    doc.font("Helvetica").fontSize(8.5);
    if (!input.children.length) {
      doc.fillColor(MUTED).text("—", layout.margin, y);
      y += 11;
    } else {
      for (const child of input.children) {
        const line = `${child.name} — ${child.grade}`;
        const h = doc.heightOfString(line, { width: layout.contentW, lineGap: 0.5 });
        doc.fillColor(INK).text(line, layout.margin, y, { width: layout.contentW, lineGap: 0.5 });
        y += h + 2;
      }
    }
    y += 6;
    doc.strokeColor(LINE).lineWidth(0.75).moveTo(layout.margin, y).lineTo(layout.pageW - layout.margin, y).stroke();
    y += 8;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= layout.bottomLimit) return;
    doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    y = layout.margin;
    drawContinuationHeader();
  };

  drawFullHeader();
  drawTableHead();

  const displayRows = buildStatementDisplayRows(input);

  if (!displayRows.length) {
    ensureSpace(TABLE_ROW_MIN_PT + 4);
    const emptyH = TABLE_ROW_MIN_PT + 4;
    doc.strokeColor(ROW_BORDER).rect(layout.margin, y, layout.contentW, emptyH).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text("No transactions for the selected period.", layout.margin, y + 4, {
      width: layout.contentW,
      align: "center",
    });
    y += emptyH + 4;
  } else {
    displayRows.forEach((row, index) => {
      const values = [
        row.date,
        row.type,
        row.reference,
        row.description,
        formatStatementAmountCell(row.amount),
        formatStatementBalanceCell(row.balance),
      ];
      const rowH = measureRowHeight(doc, values, colWidths);
      ensureSpace(rowH + 1);
      drawTableRow(doc, values, colWidths, layout.margin, y, rowH, index % 2 === 1, {
        bold: Boolean(row.bold),
      });
      y += rowH;
    });
  }

  const closingH = 22;
  ensureSpace(closingH + 14);
  y += 8;
  doc.strokeColor(LINE).lineWidth(1).moveTo(layout.margin, y).lineTo(layout.pageW - layout.margin, y).stroke();
  y += 8;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11);
  doc.text("Closing Balance", layout.margin, y, { width: layout.contentW * 0.55 });
  doc.text(formatStatementSignedMoney(input.balance), layout.margin, y, {
    width: layout.contentW,
    align: "right",
  });
  y += 16;

  if (input.statementNote) {
    ensureSpace(28);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    const noteH = doc.heightOfString(input.statementNote, { width: layout.contentW, lineGap: 0.5 });
    doc.text(input.statementNote, layout.margin, y, { width: layout.contentW, lineGap: 0.5 });
    y += noteH + 6;
  }

  // Stamp banking details + Page X / Y on every page of this statement.
  const pageRangeAfter = typeof doc.bufferedPageRange === "function" ? doc.bufferedPageRange() : null;
  const endIndex = pageRangeAfter
    ? pageRangeAfter.start + pageRangeAfter.count - 1
    : startIndex;
  const pageCount = endIndex - firstPageIndexForFooter + 1;
  for (let i = 0; i < pageCount; i += 1) {
    doc.switchToPage(firstPageIndexForFooter + i);
    const footerTop = layout.pageH - PAGE_MARGIN_PT - footerReserve + 4;
    doc.save();
    doc.strokeColor(LINE).lineWidth(0.75).moveTo(layout.margin, footerTop).lineTo(layout.pageW - layout.margin, footerTop).stroke();
    let fy = footerTop + 6;
    if (bankingLines.length) {
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(FOOTER_BANKING_FONT);
      doc.text("Banking details", layout.margin, fy, { width: layout.contentW * 0.7 });
      fy += 10;
      doc.font("Helvetica").fontSize(FOOTER_BANKING_FONT).fillColor(MUTED);
      for (const line of bankingLines) {
        doc.text(line, layout.margin, fy, { width: layout.contentW * 0.72 });
        fy += 9;
      }
    }
    doc.fillColor(MUTED).font("Helvetica").fontSize(FOOTER_PAGE_FONT);
    doc.text(`Page ${i + 1} / ${pageCount}`, layout.margin, layout.pageH - PAGE_MARGIN_PT - 4, {
      width: layout.contentW,
      align: "right",
    });
    doc.restore();
  }

  return { startPageIndex: startIndex, endPageIndex: endIndex };
}

/**
 * Generates a valid PDF buffer (%PDF header) for a single account statement.
 */
export async function generateStatementPdfBuffer(
  input: StatementPdfInput,
  opts?: { logoBuffer?: Buffer | null }
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margin: 0,
    autoFirstPage: true,
    bufferPages: true,
  });

  const logoBuf =
    opts && "logoBuffer" in opts
      ? opts.logoBuffer ?? null
      : await loadSchoolLogoBuffer(input.school.logoUrl);

  const logoImage = logoBuf ? openPdfKitImage(doc, logoBuf) : null;
  drawStatementOntoDocument(doc, input, { logoImage, logoBuffer: logoBuf });
  return finalizePdfDocument(doc);
}

/**
 * Single-pass combined statements PDF — one PDFKit document, shared logo/fonts.
 * Each family statement starts on a new page. No per-family merge.
 * Preserves production bulk PDF performance path.
 */
export async function generateCombinedStatementsPdfBuffer(
  inputs: StatementPdfInput[],
  opts?: { logoBuffer?: Buffer | null }
): Promise<{
  buffer: Buffer;
  pageCount: number;
  statementCount: number;
  firstPageIndexByStatement: number[];
}> {
  if (!inputs.length) {
    throw new Error("No statement inputs for combined PDF");
  }

  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
  });

  const logoBuf = opts && "logoBuffer" in opts ? opts.logoBuffer ?? null : null;
  let logoImage: PdfKitImageHandle | null = null;
  const firstPageIndexByStatement: number[] = [];

  for (let i = 0; i < inputs.length; i += 1) {
    doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    if (!logoImage && logoBuf) {
      logoImage = openPdfKitImage(doc, logoBuf);
    }
    const drawn = drawStatementOntoDocument(doc, inputs[i], { logoImage, logoBuffer: logoBuf });
    firstPageIndexByStatement.push(drawn.startPageIndex);
  }

  for (let i = 1; i < firstPageIndexByStatement.length; i += 1) {
    if (firstPageIndexByStatement[i] <= firstPageIndexByStatement[i - 1]) {
      throw new Error("Family statements are not separated onto new pages.");
    }
  }

  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  const buffer = await finalizePdfDocument(doc);

  return {
    buffer,
    pageCount: Math.max(pageCount, inputs.length),
    statementCount: inputs.length,
    firstPageIndexByStatement,
  };
}
