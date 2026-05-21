import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { StatementPdfInput } from "./statementPdfTypes";

const INK = "#111827";
const MUTED = "#6b7280";
const GOLD = "#d4af37";
const TABLE_HEAD = "#111827";
const ROW_ALT = "#faf8f0";
const ROW_BORDER = "#e5e7eb";

function formatMoney(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sanitizeFilename(filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").trim();
  return safe.endsWith(".pdf") ? safe : `${safe || "statement"}.pdf`;
}

export function statementPdfFilename(accountNo: string): string {
  return sanitizeFilename(`${(accountNo || "statement").replace(/[^\w.-]+/g, "_")}-statement.pdf`);
}

async function loadLogoBuffer(logoUrl?: string): Promise<Buffer | null> {
  const url = String(logoUrl || "").trim();
  if (!url) return null;

  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    if (url.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), url.replace(/^\//, ""));
      if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
    }
  } catch {
    return null;
  }
  return null;
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

/**
 * Generates a valid PDF buffer (%PDF header) for account statements.
 */
export async function generateStatementPdfBuffer(input: StatementPdfInput): Promise<Buffer> {
  const layout = input.isFamilyAccount ? "landscape" : "portrait";
  const doc = new PDFDocument({ size: "A4", layout, margin: 40 });
  const chunks: Buffer[] = [];

  const pageW = doc.page.width;
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = margin;

  const logoBuf = await loadLogoBuffer(input.school.logoUrl);
  if (logoBuf) {
    try {
      doc.image(logoBuf, margin, y, { fit: [80, 48] });
      y += 52;
    } catch {
      /* skip invalid logo */
    }
  }

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(16);
  doc.text(String(input.school.name || "School").trim() || "School", margin, y, { width: contentW * 0.55 });
  doc.fontSize(20).text("STATEMENT", margin, y, { width: contentW, align: "right" });
  y += 22;

  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  if (input.school.address) {
    doc.text(input.school.address, margin, y);
    y += 12;
  }
  const schoolContact = [input.school.email, input.school.phone].filter(Boolean).join(" | ");
  if (schoolContact) {
    doc.text(schoolContact, margin, y);
    y += 12;
  }

  doc.text(`Account: ${input.accountNo}`, margin, y, { width: contentW, align: "right" });
  y += 12;
  doc.text(`Period: ${input.period}`, margin, y, { width: contentW, align: "right" });
  y += 12;
  doc.text(`Date: ${input.statementDate}`, margin, y, { width: contentW, align: "right" });
  y += 16;

  doc.strokeColor(GOLD).lineWidth(1.5).moveTo(margin, y).lineTo(pageW - margin, y).stroke();
  y += 14;

  const boxH = 70;
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
  for (const child of input.children.slice(0, 3)) {
    doc.text(`${child.name} · Grade ${child.grade}`, margin + 8, boxY, { width: boxW - 16 });
    boxY += 12;
  }
  if (input.children.length > 3) {
    doc.text(`+${input.children.length - 3} more learner(s)`, margin + 8, boxY);
  }

  const contactName = input.contact?.name || input.accountLabel;
  const contactEmail = input.contact?.email || "—";
  const contactRel = input.contact?.relationship || "Parent";
  doc.text(`Name: ${contactName}`, margin + boxW + 20, y + 20, { width: boxW - 16 });
  doc.text(`Email: ${contactEmail}`, margin + boxW + 20, y + 32, { width: boxW - 16 });
  doc.text(`Relationship: ${contactRel}`, margin + boxW + 20, y + 44, { width: boxW - 16 });
  y += boxH + 16;

  const headers = input.isFamilyAccount
    ? ["Date", "Type", "Learner", "Reference", "Description", "In", "Out", "Balance"]
    : ["Date", "Type", "Reference", "Description", "In", "Out", "Balance"];

  const fixedCols = input.isFamilyAccount ? [52, 44, 68, 62, 0, 52, 52, 68] : [56, 48, 72, 0, 56, 56, 72];
  const fixedSum = fixedCols.reduce((s, w) => s + (w || 0), 0);
  const descW = Math.max(80, contentW - fixedSum);
  const colWidths = input.isFamilyAccount
    ? [52, 44, 68, 62, descW, 52, 52, 68]
    : [56, 48, 72, descW, 56, 56, 72];

  const rowH = 16;
  const bottomLimit = doc.page.height - 50;

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
            formatMoney(row.balance),
          ]
        : [
            row.date,
            row.type,
            row.reference,
            row.description,
            row.amountIn ? formatMoney(row.amountIn) : "-",
            row.amountOut ? formatMoney(row.amountOut) : "-",
            formatMoney(row.balance),
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
    doc.page.height - 36,
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
