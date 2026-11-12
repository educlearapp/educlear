import jsPDF from "jspdf";
import { authenticatedFetch } from "../api";
import { cacheSchoolLogoUrl, resolveSchoolLogoUrl } from "../utils/schoolLogo";
import {
  loadBillingSettingsForSchool,
  resolveEmailTemplate,
  substituteBillingTokens,
} from "./billingSettingsEngine";
import { DEFAULT_STATEMENT_PERIOD, normalizeStatementPeriod } from "./statementPeriod";
import {
  resolveStatementBillingContact,
  type StatementContact,
} from "./statementBillingContact";

export type { StatementContact } from "./statementBillingContact";
export { resolveStatementBillingContact } from "./statementBillingContact";

export type StatementTransaction = {
  date: string;
  type: string;
  reference: string;
  description: string;
  amountIn: number;
  amountOut: number;
  balance: number | null;
  learner?: string;
  statementSection?: "historical" | "brought-forward" | "active";
};

export type StatementSchoolBranding = {
  name: string;
  email?: string;
  phone?: string;
  cellNo?: string;
  address?: string;
  postalAddress?: string;
  logoUrl?: string;
  bankingDetails?: string;
};

function normaliseStatementNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function signedStatementAmount(amountIn: unknown, amountOut: unknown): number {
  return normaliseStatementNumber(amountIn) - normaliseStatementNumber(amountOut);
}

/** Kid-e-Sys signed money: R3,190.70 owing / -R309.30 credit. */
function formatStatementSignedMoney(value: unknown): string {
  const n = normaliseStatementNumber(value);
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n < 0) return `-R${body}`;
  return `R${body}`;
}

function formatStatementAmountCell(value: unknown | null | undefined): string {
  if (value === null || value === undefined) return "";
  return formatStatementSignedMoney(value);
}

function formatStatementBalanceCell(value: unknown | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatStatementSignedMoney(value);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export { absolutizeSchoolLogoUrl, resolveSchoolLogoUrl } from "../utils/schoolLogo";

function cachedSchoolLogoUrl(): string {
  return resolveSchoolLogoUrl({ logoUrl: localStorage.getItem("schoolLogoUrl") });
}

export async function loadStatementSchoolBranding(schoolId: string): Promise<StatementSchoolBranding> {
  const fallbackName = String(localStorage.getItem("schoolName") || "School").trim() || "School";
  const fallbackLogoUrl = cachedSchoolLogoUrl();
  if (!schoolId) {
    return { name: fallbackName, logoUrl: fallbackLogoUrl || undefined };
  }
  try {
    const res = await authenticatedFetch(`/api/schools/${encodeURIComponent(schoolId)}`);
    if (!res.ok) throw new Error("Failed to load school branding");
    const match = (await res.json()) as Record<string, unknown>;
    const logoUrl =
      resolveSchoolLogoUrl({ logoUrl: String(match.logoUrl || "").trim() || null }) ||
      fallbackLogoUrl;
    if (logoUrl) cacheSchoolLogoUrl(logoUrl);
    return {
      name: String(match.name || fallbackName).trim() || fallbackName,
      email: String(match.email || "").trim() || undefined,
      phone: String(match.phone || match.telephone || "").trim() || undefined,
      cellNo: String(match.cellNo || "").trim() || undefined,
      address: String(match.address || match.physicalAddress || "").trim() || undefined,
      postalAddress: String(match.postalAddress || "").trim() || undefined,
      logoUrl: logoUrl || undefined,
      bankingDetails: String(match.bankingDetails || "").trim() || undefined,
    };
  } catch {
    return { name: fallbackName, logoUrl: fallbackLogoUrl || undefined };
  }
}

const GOLD = "#d4af37";
const INK = "#111827";

function plainTextToEmailParagraphs(text: string): string {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${INK}">${escapeHtml(line)}</p>`)
    .join("");
}

/** Premium HTML body for statement emails (cover message — PDF remains the attachment). */
export function buildStatementCoverEmailHtml(input: {
  school: StatementSchoolBranding;
  messagePlain: string;
}): string {
  const { school, messagePlain } = input;
  const schoolName = escapeHtml(school.name || "School");
  const logoBlock = school.logoUrl
    ? `<img src="${escapeHtml(school.logoUrl)}" alt="" width="120" height="auto" style="display:block;max-width:120px;max-height:96px;object-fit:contain;margin:0 auto 16px" />`
    : "";

  const contactBits = [
    school.address ? escapeHtml(school.address) : "",
    school.email ? escapeHtml(school.email) : "",
    school.phone ? escapeHtml(school.phone) : "",
  ].filter(Boolean);

  const contactLine = contactBits.length
    ? `<p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;text-align:center">${contactBits.join(" · ")}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${schoolName} — Statement</title>
</head>
<body style="margin:0;padding:0;background:#f3f0ea;font-family:Arial,Helvetica,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f0ea;padding:28px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e8e2d6;box-shadow:0 8px 28px rgba(17,24,39,0.08)">
          <tr>
            <td style="background:linear-gradient(135deg,#0f0f0f 0%,#1a1a1a 100%);padding:22px 28px;text-align:center">
              ${logoBlock}
              <div style="font-size:20px;font-weight:900;color:${GOLD};letter-spacing:0.02em">${schoolName}</div>
              ${contactLine}
            </td>
          </tr>
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#b89329 0%,${GOLD} 50%,#f7d56a 100%);font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 28px 24px">
              ${plainTextToEmailParagraphs(messagePlain)}
              <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#374151">
                Your statement of account is attached to this email as a PDF.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px">
              <div style="border-top:1px solid #e5e7eb;padding-top:16px;text-align:center">
                <p style="margin:0 0 6px;font-size:11px;line-height:1.5;color:#6b7280">
                  This statement was generated securely via EduClear.
                </p>
                <p style="margin:0;font-size:11px;color:#9ca3af">${schoolName}</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function buildStatementEmailDefaults(
  schoolId: string,
  schoolName: string,
  accountLabel: string,
  contactName: string
): Promise<{ subject: string; message: string }> {
  const settings = await loadBillingSettingsForSchool(schoolId);
  const template = resolveEmailTemplate(settings, "statement");
  const tokens: Record<string, string> = {
    school_name: schoolName,
    learner_name: accountLabel,
    contact_name: contactName,
    document_type: "Statement",
    document_no: "",
  };
  return {
    subject:
      substituteBillingTokens(template.subject, tokens) ||
      `${schoolName} — Statement of Account`,
    message:
      substituteBillingTokens(template.message, tokens) ||
      `Dear ${contactName},\n\nPlease find your statement of account attached.\n\nKind regards,\n${schoolName}`,
  };
}

export type AccountStatementDocumentInput = {
  school: StatementSchoolBranding;
  accountNo: string;
  accountLabel: string;
  children: { name: string; grade: string }[];
  contact: StatementContact | null;
  period: string;
  statementDate: string;
  balance: number;
  transactions: StatementTransaction[];
  statementNote?: string;
  isFamilyAccount: boolean;
  openingBalance?: number;
  includeBroughtForward?: boolean;
  broughtForwardLabel?: string;
};

const PDF_INK: [number, number, number] = [17, 24, 39];
const PDF_MUTED: [number, number, number] = [107, 114, 128];
/** ~36 pt logo box — matches server PDF compact layout. */
export const STATEMENT_LOGO_PX = 72;
/** Matches server PDF logo box (36 pt). */
const STATEMENT_LOGO_MAX_MM = (36 * 25.4) / 72;
const STATEMENT_LOGO_GAP_MM = 2;
export const STATEMENT_LOGO_IMG_STYLE = `display:block;width:${STATEMENT_LOGO_PX}px;height:${STATEMENT_LOGO_PX}px;max-width:${STATEMENT_LOGO_PX}px;max-height:${STATEMENT_LOGO_PX}px;object-fit:contain;margin:0 0 6px 0`;

function embedStatementLogoInPdf(doc: jsPDF, logoUrl: string, x: number, y: number): number {
  for (const format of ["PNG", "JPEG"] as const) {
    try {
      const props = doc.getImageProperties(logoUrl);
      const aspect = props.width / props.height;
      let w = STATEMENT_LOGO_MAX_MM;
      let h = STATEMENT_LOGO_MAX_MM;
      if (aspect >= 1) {
        h = STATEMENT_LOGO_MAX_MM / aspect;
      } else {
        w = STATEMENT_LOGO_MAX_MM * aspect;
      }
      doc.addImage(logoUrl, format, x, y, w, h, undefined, "FAST");
      return h + STATEMENT_LOGO_GAP_MM;
    } catch {
      /* try next format */
    }
  }
  return 0;
}

function sanitizeStatementFilename(filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").trim();
  return safe.endsWith(".pdf") ? safe : `${safe || "statement"}.pdf`;
}

function pdfArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function splitNonEmptyLines(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function schoolBrandingLines(school: StatementSchoolBranding): string[] {
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

type StatementDisplayRow = {
  date: string;
  type: string;
  reference: string;
  description: string;
  amount: number | null;
  balance: number | null;
  bold?: boolean;
};

/** Presentation-only: reuse builder amounts/balances; do not invent running balances. */
function buildFrontendStatementDisplayRows(input: AccountStatementDocumentInput): StatementDisplayRow[] {
  const opening = normaliseStatementNumber(input.openingBalance ?? 0);
  const chronological = [...(input.transactions || [])].sort((a, b) => {
    const da = new Date(a.date || "").getTime();
    const db = new Date(b.date || "").getTime();
    const ta = Number.isNaN(da) ? 0 : da;
    const tb = Number.isNaN(db) ? 0 : db;
    if (ta !== tb) return ta - tb;
    return String(a.reference || "").localeCompare(String(b.reference || ""));
  });
  const rows: StatementDisplayRow[] = [];
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
    if (row.balance === null || row.balance === undefined || Number.isNaN(Number(row.balance))) {
      rows.push({
        date: row.date || "",
        type: row.type || "",
        reference: row.reference || "",
        description: row.description || "",
        amount: signed,
        balance: null,
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
    });
  }
  return rows;
}

/** Builds a valid PDF (jsPDF) matching the Kid-e-Sys account statement layout. */
export function generateAccountStatementPdf(input: AccountStatementDocumentInput): jsPDF {
  const { school, accountNo, accountLabel, children, contact, period, statementDate, balance, statementNote } =
    input;
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  const leftW = contentW * 0.58;
  const rightW = contentW - leftW - 3;
  const leftX = margin;
  const rightX = margin + leftW + 3;
  const bankingLines = splitNonEmptyLines(school.bankingDetails);
  const footerReserve = Math.max(18, 8 + (bankingLines.length ? 6 + bankingLines.length * 3.6 : 0) + 6);
  let y = margin;

  const headers = ["Date", "Type", "Ref", "Description", "Amount", "Balance"];
  const fixedCols = [22, 18, 22, 24, 24];
  const descW = Math.max(40, contentW - fixedCols.reduce((sum, w) => sum + w, 0));
  const colWidths = [22, 18, 22, descW, 24, 24];

  const drawTableHeader = () => {
    doc.setFillColor(...PDF_INK);
    doc.rect(margin, y, contentW, 5.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    let x = margin + 1.5;
    headers.forEach((label, i) => {
      const alignRight = i >= headers.length - 2;
      const w = colWidths[i];
      doc.text(label, alignRight ? x + w - 1.5 : x, y + 3.8, { align: alignRight ? "right" : "left" });
      x += w;
    });
    y += 5.5;
  };

  const drawContinuationHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_INK);
    doc.text(String(school.name || "School"), leftX, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text("Statement (continued)", rightX + rightW, y, { align: "right" });
    y += 5;
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 3;
    drawTableHeader();
  };

  const ensureRowSpace = (needed: number) => {
    if (y + needed <= pageH - footerReserve) return;
    doc.addPage();
    y = margin;
    drawContinuationHeader();
  };

  let leftY = margin;
  if (school.logoUrl) {
    const logoAdvance = embedStatementLogoInPdf(doc, school.logoUrl, leftX, leftY);
    if (logoAdvance > 0) leftY += logoAdvance;
  }

  doc.setTextColor(...PDF_INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const schoolName = String(school.name || "School").trim() || "School";
  doc.text(schoolName, leftX, leftY);
  leftY += 5;

  let rightY = margin;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_MUTED);
  for (const line of schoolBrandingLines(school)) {
    const wrapped = doc.splitTextToSize(line, rightW) as string[];
    doc.text(wrapped, rightX + rightW, rightY, { align: "right" });
    rightY += wrapped.length * 3.5 + 0.8;
  }

  y = Math.max(leftY, rightY) + 4;
  doc.setDrawColor(209, 213, 219);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setTextColor(...PDF_INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Statement", margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const contactName = contact?.name || accountLabel;
  const meta = [
    `Parent / Guardian: ${contactName}`,
    `Account number: ${accountNo}`,
    `Statement date: ${statementDate}`,
    `Period: ${period}`,
  ];
  for (const line of meta) {
    doc.text(line, margin, y);
    y += 4;
  }
  y += 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_INK);
  doc.text("Learners", margin, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  if (!children.length) {
    doc.setTextColor(...PDF_MUTED);
    doc.text("—", margin, y);
    y += 4;
  } else {
    for (const child of children) {
      doc.setTextColor(...PDF_INK);
      doc.text(`${child.name} — ${child.grade}`, margin, y);
      y += 3.8;
    }
  }
  y += 2;
  doc.setDrawColor(209, 213, 219);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  drawTableHeader();

  const displayRows = buildFrontendStatementDisplayRows(input);
  if (!displayRows.length) {
    ensureRowSpace(7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text("No transactions for the selected period.", pageW / 2, y + 4, { align: "center" });
    y += 8;
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
      const descLines = doc.splitTextToSize(String(row.description || ""), colWidths[3] - 2) as string[];
      const rowH = Math.max(5.2, descLines.length * 3.4 + 1.5);
      ensureRowSpace(rowH + 1);
      if (index % 2 === 1) {
        doc.setFillColor(249, 250, 251);
        doc.rect(margin, y, contentW, rowH, "F");
      }
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, y + rowH, pageW - margin, y + rowH);
      doc.setFont("helvetica", row.bold ? "bold" : "normal");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_INK);
      let x = margin + 1.2;
      values.forEach((value, i) => {
        const w = colWidths[i] - 2.4;
        const alignRight = i >= values.length - 2;
        if (i === 3) {
          doc.text(descLines, x, y + 3.4);
        } else {
          const line = String(value || "");
          doc.text(line, alignRight ? x + w : x, y + 3.4, { align: alignRight ? "right" : "left" });
        }
        x += colWidths[i];
      });
      y += rowH;
    });
  }

  ensureRowSpace(14);
  y += 4;
  doc.setDrawColor(209, 213, 219);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_INK);
  doc.text("Closing Balance", margin, y);
  doc.text(formatStatementSignedMoney(balance), pageW - margin, y, { align: "right" });
  y += 8;

  if (statementNote) {
    ensureRowSpace(10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    const noteLines = doc.splitTextToSize(String(statementNote), contentW) as string[];
    doc.text(noteLines, margin, y);
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    const footerTop = pageH - footerReserve + 2;
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.3);
    doc.line(margin, footerTop, pageW - margin, footerTop);
    let fy = footerTop + 4;
    if (bankingLines.length) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_INK);
      doc.text("Banking details", margin, fy);
      fy += 3.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_MUTED);
      for (const line of bankingLines) {
        doc.text(line, margin, fy);
        fy += 3.3;
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`Page ${i} / ${pageCount}`, pageW - margin, pageH - 6, { align: "right" });
  }

  return doc;
}

export function accountStatementToPdfBase64(input: AccountStatementDocumentInput): string {
  const doc = generateAccountStatementPdf(input);
  return pdfArrayBufferToBase64(doc.output("arraybuffer"));
}

export function buildAccountStatementHtml(input: AccountStatementDocumentInput): string {
  const { school, accountNo, accountLabel, children, contact, period, statementDate, balance, statementNote } =
    input;

  const logoBlock = school.logoUrl
    ? `<img src="${escapeHtml(school.logoUrl)}" alt="" style="${STATEMENT_LOGO_IMG_STYLE}" />`
    : "";

  const childLines = children.length
    ? `<ul style="margin:6px 0 0;padding-left:18px">${children
        .map((c) => `<li>${escapeHtml(c.name)} — ${escapeHtml(c.grade)}</li>`)
        .join("")}</ul>`
    : `<div class="muted">—</div>`;

  const displayRows = buildFrontendStatementDisplayRows(input);
  const txRows = displayRows.length
    ? displayRows
        .map((row) => {
          const cols = [
            `<td>${escapeHtml(row.date)}</td>`,
            `<td>${escapeHtml(row.type)}</td>`,
            `<td>${escapeHtml(row.reference)}</td>`,
            `<td style="white-space:normal;word-break:break-word">${escapeHtml(row.description)}</td>`,
            `<td style="text-align:right;white-space:nowrap">${escapeHtml(formatStatementAmountCell(row.amount))}</td>`,
            `<td style="text-align:right;white-space:nowrap;font-weight:${row.bold ? 800 : 600}">${escapeHtml(
              formatStatementBalanceCell(row.balance)
            )}</td>`,
          ];
          return `<tr class="${row.bold ? "bf" : ""}">${cols.join("")}</tr>`;
        })
        .join("")
    : `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px">No transactions for the selected period.</td></tr>`;

  const bankingLines = splitNonEmptyLines(school.bankingDetails);
  const bankingBlock = bankingLines.length
    ? `<div class="banking"><div class="banking-title">Banking details</div>${bankingLines
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join("")}</div>`
    : "";

  const contactName = contact?.name || accountLabel;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Statement - ${escapeHtml(accountNo)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 12mm; background: #fff; max-width: 210mm; box-sizing: border-box; font-size: 11px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 10px; border-bottom: 1px solid #d1d5db; margin-bottom: 10px; }
    .header-left { flex: 1 1 55%; min-width: 0; }
    .header-right { flex: 0 0 auto; text-align: right; max-width: 42%; }
    .school-name { font-size: 17px; font-weight: 800; margin: 0; line-height: 1.2; }
    .muted { color: #4b5563; font-size: 10px; line-height: 1.45; }
    .muted p { margin: 0 0 2px; }
    .title { font-size: 18px; font-weight: 800; margin: 0 0 8px; }
    .meta { font-size: 11px; line-height: 1.45; margin-bottom: 8px; }
    .meta div { margin: 0 0 2px; }
    .learners { margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid #d1d5db; }
    .learners-title { font-size: 11px; font-weight: 800; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th { background: #111827; color: #fff; padding: 6px 6px; font-size: 9px; text-align: left; font-weight: 700; }
    th:nth-child(5), th:nth-child(6), td:nth-child(5), td:nth-child(6) { text-align: right; }
    td { border-bottom: 1px solid #e5e7eb; padding: 5px 6px; font-size: 9px; vertical-align: top; }
    tr:nth-child(even) td { background: #f9fafb; }
    tr.bf td { font-weight: 700; }
    .closing { margin-top: 12px; padding-top: 8px; border-top: 1px solid #d1d5db; display: flex; justify-content: space-between; font-size: 14px; font-weight: 800; }
    .banking { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d1d5db; font-size: 10px; color: #4b5563; line-height: 1.45; }
    .banking-title { font-weight: 800; color: #111827; margin-bottom: 4px; }
    .page-foot { margin-top: 10px; font-size: 10px; color: #6b7280; text-align: right; }
    @media print {
      body { padding: 0; }
      .banking, .closing { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      ${logoBlock}
      <div class="school-name">${escapeHtml(school.name)}</div>
    </div>
    <div class="header-right muted">
      ${schoolBrandingLines(school)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")}
    </div>
  </div>
  <div class="title">Statement</div>
  <div class="meta">
    <div>Parent / Guardian: ${escapeHtml(contactName)}</div>
    <div>Account number: ${escapeHtml(accountNo)}</div>
    <div>Statement date: ${escapeHtml(statementDate)}</div>
    <div>Period: ${escapeHtml(period)}</div>
  </div>
  <div class="learners">
    <div class="learners-title">Learners</div>
    ${childLines}
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:12%">Date</th>
        <th style="width:12%">Type</th>
        <th style="width:12%">Ref</th>
        <th>Description</th>
        <th style="width:14%">Amount</th>
        <th style="width:14%">Balance</th>
      </tr>
    </thead>
    <tbody>${txRows}</tbody>
  </table>
  <div class="closing"><span>Closing Balance</span><span>${escapeHtml(formatStatementSignedMoney(balance))}</span></div>
  ${statementNote ? `<p style="margin-top:16px;line-height:1.5;white-space:pre-wrap;color:#4b5563">${escapeHtml(statementNote)}</p>` : ""}
  ${bankingBlock}
  <div class="page-foot">Page 1</div>
</body>
</html>`;
}

/** @deprecated Use accountStatementToPdfBase64 for statement PDF attachments. */
export function htmlToBase64(html: string): string {
  return btoa(unescape(encodeURIComponent(html)));
}

export function openStatementPrintWindow(html: string, autoPrint = false): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  if (autoPrint) {
    const triggerPrint = () => {
      try {
        win.focus();
        win.print();
      } catch {
        /* ignore */
      }
    };
    if (win.document.readyState === "complete") {
      setTimeout(triggerPrint, 400);
    } else {
      win.onload = () => setTimeout(triggerPrint, 400);
    }
  }
  return true;
}

/** Downloads a valid PDF from the server statement generator. */
export async function downloadAccountStatementPdf(
  _input: AccountStatementDocumentInput,
  filename = "statement.pdf"
): Promise<void> {
  void _input;
  void filename;
  throw new Error("Use downloadSchoolStatementPdf instead — PDFs are generated on the server.");
}

const statementPdfDownloadInflight = new Map<string, Promise<void>>();

function triggerBlobDownload(blob: Blob, filename: string) {
  const safe = sanitizeStatementFilename(filename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safe;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function runSingleStatementPdfDownload(key: string, task: () => Promise<void>): Promise<void> {
  const existing = statementPdfDownloadInflight.get(key);
  if (existing) return existing;
  const promise = task().finally(() => {
    statementPdfDownloadInflight.delete(key);
  });
  statementPdfDownloadInflight.set(key, promise);
  return promise;
}

/** Validates %PDF magic even when the server sends application/octet-stream. */
async function blobLooksLikePdf(blob: Blob): Promise<boolean> {
  if (blob.type.includes("pdf")) return true;
  const head = await blob.slice(0, 5).arrayBuffer();
  const magic = new TextDecoder().decode(head);
  return magic.startsWith("%PDF");
}

export async function fetchSchoolStatementPdfBlob(
  schoolId: string,
  learnerId: string,
  period = DEFAULT_STATEMENT_PERIOD,
  statementNote?: string,
  accountNo?: string,
  familyAccountId?: string
): Promise<Blob> {
  const params = new URLSearchParams({
    schoolId,
    period: normalizeStatementPeriod(period),
  });
  const billingRef = String(accountNo || "").trim();
  const faId = String(familyAccountId || "").trim();
  if (faId) params.set("familyAccountId", faId);
  if (billingRef) params.set("accountNo", billingRef);
  // Never send a FamilyAccount id in learnerId — only a real learner id (or omit).
  if (learnerId && learnerId !== faId) params.set("learnerId", learnerId);
  if (statementNote) params.set("statementNote", statementNote);
  if (!faId && !billingRef && !learnerId) {
    throw new Error("Missing account identity for statement PDF");
  }
  const res = await authenticatedFetch(`/api/statements/pdf?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(String((body as { error?: string }).error || "Failed to generate statement PDF"));
  }
  const blob = await res.blob();
  if (!(await blobLooksLikePdf(blob))) {
    throw new Error("Server did not return a valid PDF");
  }
  return blob;
}

export async function downloadSchoolStatementPdf(
  schoolId: string,
  learnerId: string,
  filename: string,
  period = DEFAULT_STATEMENT_PERIOD,
  statementNote?: string,
  accountNo?: string,
  familyAccountId?: string
): Promise<void> {
  const key = [
    "school",
    schoolId,
    learnerId,
    normalizeStatementPeriod(period),
    accountNo || "",
    familyAccountId || "",
  ].join("|");
  return runSingleStatementPdfDownload(key, async () => {
    const blob = await fetchSchoolStatementPdfBlob(
      schoolId,
      learnerId,
      period,
      statementNote,
      accountNo,
      familyAccountId
    );
    triggerBlobDownload(blob, filename);
  });
}

export async function openSchoolStatementPdfPrint(
  schoolId: string,
  learnerId: string,
  period = DEFAULT_STATEMENT_PERIOD,
  statementNote?: string,
  accountNo?: string,
  familyAccountId?: string
): Promise<boolean> {
  const blob = await fetchSchoolStatementPdfBlob(
    schoolId,
    learnerId,
    period,
    statementNote,
    accountNo,
    familyAccountId
  );
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  win.addEventListener("load", () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore */
    }
  });
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return true;
}

export async function fetchParentStatementPdfBlob(
  learnerId: string,
  token: string,
  period = DEFAULT_STATEMENT_PERIOD
): Promise<Blob> {
  const params = new URLSearchParams({
    learnerId,
    period: normalizeStatementPeriod(period),
  });
  const res = await authenticatedFetch(`/api/parent-portal/billing/statement.pdf?${params.toString()}`, {
    skipAuth: true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(String((body as { error?: string }).error || "Failed to download statement PDF"));
  }
  const blob = await res.blob();
  if (!(await blobLooksLikePdf(blob))) {
    throw new Error("Server did not return a valid PDF");
  }
  return blob;
}

export async function downloadParentStatementPdf(
  learnerId: string,
  filename: string,
  token: string,
  period = DEFAULT_STATEMENT_PERIOD
): Promise<void> {
  const key = ["parent", learnerId, normalizeStatementPeriod(period), token.slice(0, 12)].join("|");
  return runSingleStatementPdfDownload(key, async () => {
    const blob = await fetchParentStatementPdfBlob(learnerId, token, period);
    triggerBlobDownload(blob, filename);
  });
}

export async function openParentStatementPdfPrint(
  learnerId: string,
  token: string,
  period = DEFAULT_STATEMENT_PERIOD
): Promise<boolean> {
  const blob = await fetchParentStatementPdfBlob(learnerId, token, period);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  win.addEventListener("load", () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore */
    }
  });
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return true;
}

export async function sendStatementEmail(payload: {
  schoolId: string;
  to: string;
  subject: string;
  html: string;
  learnerId?: string;
  accountNo?: string;
  familyAccountId?: string;
  accountIdentityType?: "familyAccountId" | "accountRef" | "accountNo" | "learnerId";
  accountIdentityValue?: string;
  period?: string;
  statementNote?: string;
  filename?: string;
  /** Invoice-run bulk email uses period-ledger closing balances. */
  closingBalanceSource?: "age-analysis" | "period-ledger";
}): Promise<{ messageId?: string }> {
  const response = await authenticatedFetch(`/api/emails/send-statement`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(
      String((body as { error?: string }).error || "Failed to send statement email")
    ) as Error & { setupRequired?: boolean };
    err.setupRequired = Boolean((body as { setupRequired?: boolean }).setupRequired);
    throw err;
  }
  return body as { messageId?: string };
}
