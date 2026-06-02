import PDFDocument from "pdfkit";
import { loadSchoolLogoBuffer } from "../utils/schoolLogo";
import type { StatementPdfInput } from "./statementPdfTypes";

const INK = "#111827";
const MUTED = "#6b7280";
const GOLD = "#d4af37";
const TABLE_HEAD = "#111827";
const ROW_ALT = "#faf8f0";
const ROW_BORDER = "#e5e7eb";
/** Max logo dimension in PDF points. Aspect ratio preserved via fit. */
const STATEMENT_LOGO_MAX_PT = 52;
const STATEMENT_LOGO_GAP_PT = 6;
/** ~14 mm side margins on A4 portrait */
const PAGE_MARGIN_PT = 40;
const SCHOOL_NAME_FONT_SIZE = 14;
const CONTACT_FONT_SIZE = 8;
const SCHOOL_NAME_LINE_GAP_PT = 8;
const CONTACT_LINE_GAP_PT = 5;

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

/** One PDF line per address / contact field — no combined multiline blocks. */
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
  gapAfter: number
): number {
  const h = doc.heightOfString(text, { width });
  doc.text(text, x, y, { width, lineGap: 1 });
  return y + h + gapAfter;
}

function sanitizeFilename(filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").trim();
  return safe.endsWith(".pdf") ? safe : `${safe || "statement"}.pdf`;
}

export function statementPdfFilename(accountNo: string): string {
  return sanitizeFilename(`${(accountNo || "statement").replace(/[^\w.-]+/g, "_")}-statement.pdf`);
}

function drawTableHeader(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  colWidths: number[],
  x0: number,
  y: number,
  rowH: number
) {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  doc.save();
  doc.rect(x0, y, totalW, rowH).fill(TABLE_HEAD);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
  let x = x0 + 4;
  headers.forEach((label, i) => {
    const w = colWidths[i];
    const alignRight = i >= headers.length - 3;
    doc.text(label, alignRight ? x + w - 4 : x, y + 4, {
      width: w - 8,
      align: alignRight ? "right" : "left",
      lineBreak: false,
    });
    x += w;
  });
  doc.restore();
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
    const text = String(value || "").slice(0, 80);
    doc.text(text, alignRight ? x + w - 4 : x, y + 3, {
      width: w - 8,
      align: alignRight ? "right" : "left",
      lineBreak: false,
    });
    x += w;
  });
}

function measureAccountBoxHeight(input: StatementPdfInput): number {
  const learnerCount = input.children.length;
  const showLearnersList = input.isFamilyAccount || learnerCount > 1;
  let h = 52;
  if (showLearnersList) h += 14 + learnerCount * 11;
  else if (learnerCount === 1) h += 11;
  return Math.max(72, h);
}

/**
 * Generates a valid PDF buffer (%PDF header) for account statements.
 */
export async function generateStatementPdfBuffer(input: StatementPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  const chunks: Buffer[] = [];

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = PAGE_MARGIN_PT;
  const contentW = pageW - margin * 2;
  const leftW = contentW * 0.58;
  const rightW = contentW - leftW - 14;
  const leftX = margin;
  const rightX = margin + leftW + 14;

  let leftY = margin;
  let rightY = margin;

  const logoBuf = await loadSchoolLogoBuffer(input.school.logoUrl);
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
  leftY = drawStackedTextLine(doc, schoolName, leftX, leftY, leftW, SCHOOL_NAME_LINE_GAP_PT);

  doc.font("Helvetica").fontSize(CONTACT_FONT_SIZE).fillColor(MUTED);
  for (const line of schoolHeaderContactLines(input.school)) {
    leftY = drawStackedTextLine(doc, line, leftX, leftY, leftW, CONTACT_LINE_GAP_PT);
  }

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20);
  doc.text("STATEMENT", rightX, rightY, { width: rightW, align: "right" });
  rightY += 28;

  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  doc.text(`Account: ${input.accountNo}`, rightX, rightY, { width: rightW, align: "right" });
  rightY += 12;
  doc.text(`Period: ${input.period}`, rightX, rightY, { width: rightW, align: "right" });
  rightY += 12;
  doc.text(`Date: ${input.statementDate}`, rightX, rightY, { width: rightW, align: "right" });
  rightY += 12;

  let y = Math.max(leftY, rightY) + 14;

  doc.strokeColor(GOLD).lineWidth(1.5).moveTo(margin, y).lineTo(pageW - margin, y).stroke();
  y += 14;

  const boxH = measureAccountBoxHeight(input);
  const boxW = (contentW - 12) / 2;
  doc.roundedRect(margin, y, boxW, boxH, 4).strokeColor(ROW_BORDER).stroke();
  doc.roundedRect(margin + boxW + 12, y, boxW, boxH, 4).strokeColor(ROW_BORDER).stroke();

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(8);
  doc.text("ACCOUNT", margin + 8, y + 8);
  doc.text("CONTACT", margin + boxW + 20, y + 8);

  doc.font("Helvetica").fontSize(8.5);
  let boxY = y + 20;
  doc.text(`Account holder: ${input.accountLabel}`, margin + 8, boxY, { width: boxW - 16 });
  boxY += 12;

  const showLearnersList = input.isFamilyAccount || input.children.length > 1;
  if (showLearnersList) {
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text("Learners:", margin + 8, boxY);
    boxY += 11;
    doc.font("Helvetica").fontSize(8.5);
    for (const child of input.children) {
      doc.text(`– ${child.name} – Grade ${child.grade}`, margin + 8, boxY, { width: boxW - 16 });
      boxY += 11;
    }
  } else if (input.children.length === 1) {
    const child = input.children[0];
    doc.text(`– ${child.name} – Grade ${child.grade}`, margin + 8, boxY, { width: boxW - 16 });
  }

  const contactName = input.contact?.name || input.accountLabel;
  const contactEmail = input.contact?.email || "—";
  const contactCell = input.contact?.cellphone || "—";
  const contactRel = input.contact?.relationship || "Parent";
  const contactAccountNo = input.contact?.accountNo || input.accountNo || "—";
  doc.font("Helvetica").fontSize(8.5);
  doc.text(`Name: ${contactName}`, margin + boxW + 20, y + 20, { width: boxW - 16 });
  doc.text(`Email: ${contactEmail}`, margin + boxW + 20, y + 32, { width: boxW - 16 });
  doc.text(`Cell: ${contactCell}`, margin + boxW + 20, y + 44, { width: boxW - 16 });
  doc.text(`Relationship: ${contactRel}`, margin + boxW + 20, y + 56, { width: boxW - 16 });
  doc.text(`Account No: ${contactAccountNo}`, margin + boxW + 20, y + 68, { width: boxW - 16 });
  y += boxH + 16;

  const headers = input.isFamilyAccount
    ? ["Date", "Type", "Learner", "Reference", "Description", "In", "Out", "Balance"]
    : ["Date", "Type", "Reference", "Description", "In", "Out", "Balance"];

  const fixedCols = input.isFamilyAccount ? [48, 40, 60, 56, 0, 48, 48, 60] : [52, 44, 68, 0, 50, 50, 64];
  const fixedSum = fixedCols.reduce((s, w) => s + (w || 0), 0);
  const descW = Math.max(72, contentW - fixedSum);
  const colWidths = input.isFamilyAccount
    ? [48, 40, 60, 56, descW, 48, 48, 60]
    : [52, 44, 68, descW, 50, 50, 64];

  const rowH = 16;
  const bottomLimit = pageH - margin - 10;

  const ensureSpace = (needed: number) => {
    if (y + needed <= bottomLimit) return;
    doc.addPage();
    y = margin;
    drawTableHeader(doc, headers, colWidths, margin, y, rowH);
    y += rowH;
  };

  drawTableHeader(doc, headers, colWidths, margin, y, rowH);
  y += rowH;

  const transactions = input.transactions || [];
  if (!transactions.length) {
    ensureSpace(rowH + 4);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text("No transactions for the selected period.", margin, y + 4, {
      width: contentW,
      align: "center",
    });
    y += rowH + 8;
  } else {
    transactions.forEach((row, index) => {
      ensureSpace(rowH + 2);
      const values = input.isFamilyAccount
        ? [
            row.date,
            row.type,
            row.learner || "-",
            row.reference,
            row.description,
            row.amountIn ? formatMoney(row.amountIn) : "-",
            row.amountOut ? formatMoney(row.amountOut) : "-",
            formatBalance(row.balance),
          ]
        : [
            row.date,
            row.type,
            row.reference,
            row.description,
            row.amountIn ? formatMoney(row.amountIn) : "-",
            row.amountOut ? formatMoney(row.amountOut) : "-",
            formatBalance(row.balance),
          ];
      drawTableRow(doc, values, colWidths, margin, y, rowH, index % 2 === 1);
      y += rowH;
    });
  }

  ensureSpace(50);
  y += 10;
  const totalW = 200;
  const totalX = pageW - margin - totalW;
  doc.roundedRect(totalX, y, totalW, 36, 4).strokeColor(GOLD).stroke();
  doc.fillColor("#991b1b").font("Helvetica-Bold").fontSize(11);
  doc.text("Closing balance", totalX + 8, y + 12);
  doc.text(formatMoney(input.balance), totalX + 8, y + 12, { width: totalW - 16, align: "right" });
  y += 48;

  if (input.statementNote) {
    ensureSpace(30);
    doc.fillColor(INK).font("Helvetica").fontSize(8.5);
    doc.text(input.statementNote, margin, y, { width: contentW });
    y += 24;
  }

  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(
    `Statement generated for ${input.school.name || "School"} via EduClear.`,
    margin,
    pageH - margin,
    { width: contentW, align: "center" }
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
