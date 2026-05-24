import jsPDF from "jspdf";
import { API_URL } from "../api";
import { cacheSchoolLogoUrl, resolveSchoolLogoUrl } from "../utils/schoolLogo";
import { formatMoney } from "./billingLedger";
import {
  loadBillingSettingsForSchool,
  resolveEmailTemplate,
  substituteBillingTokens,
} from "./billingSettingsEngine";
import { DEFAULT_STATEMENT_PERIOD, normalizeStatementPeriod } from "./statementPeriod";

export type StatementTransaction = {
  date: string;
  type: string;
  reference: string;
  description: string;
  amountIn: number;
  amountOut: number;
  balance: number;
  learner?: string;
};

export type StatementContact = {
  name: string;
  email: string;
  relationship: string;
};

export type StatementSchoolBranding = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parentDisplayName(parent: any): string {
  return (
    `${parent?.firstName || parent?.name || ""} ${parent?.surname || parent?.lastName || ""}`.trim() ||
    String(parent?.fullName || "").trim() ||
    "Parent / Guardian"
  );
}

function learnerFullName(learner: any): string {
  return `${learner?.firstName || learner?.name || ""} ${learner?.lastName || learner?.surname || ""}`.trim();
}

function collectParentPairsForLearner(learner: any, globalParents: any[]): { parent: any; link: any }[] {
  const seen = new Set<string>();
  const pairs: { parent: any; link: any }[] = [];

  const add = (rawParent: any, link: any = {}) => {
    if (!rawParent) return;
    const parent = rawParent?.parent || rawParent;
    const mergedLink = rawParent?.parent ? rawParent : link;
    const id = String(parent?.id || "").trim();
    const email = String(parent?.email || "").trim().toLowerCase();
    const key = id || `${parentDisplayName(parent)}|${email}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    pairs.push({ parent, link: mergedLink || {} });
  };

  add(learner?.parent);
  add(learner?.primaryParent);
  add(learner?.guardian);
  for (const p of learner?.parents || []) add(p);
  for (const link of learner?.links || learner?.parentLinks || []) {
    add(link?.parent || link, link);
  }

  const learnerId = String(learner?.id || learner?.learnerId || "").trim();
  const learnerName = learnerFullName(learner).toLowerCase();

  for (const parent of globalParents || []) {
    const childIds = [
      parent?.learnerId,
      parent?.childId,
      parent?.studentId,
      parent?.child?.id,
      parent?.learner?.id,
      ...(Array.isArray(parent?.learnerIds) ? parent.learnerIds : []),
      ...(Array.isArray(parent?.children) ? parent.children.map((c: any) => c?.id) : []),
      ...(Array.isArray(parent?.learners) ? parent.learners.map((c: any) => c?.id) : []),
    ]
      .filter(Boolean)
      .map(String);

    const childNames = [
      parent?.learnerName,
      parent?.childName,
      parent?.studentName,
      ...(Array.isArray(parent?.children) ? parent.children.map((c: any) => learnerFullName(c)) : []),
      ...(Array.isArray(parent?.learners) ? parent.learners.map((c: any) => learnerFullName(c)) : []),
    ]
      .map((x: any) => String(x || "").toLowerCase().trim())
      .filter(Boolean);

    if (childIds.includes(learnerId) || childNames.includes(learnerName)) {
      add(parent);
    }
  }

  return pairs;
}

function isStatementBillingContact(pair: { parent: any; link: any }): boolean {
  const parent = pair.parent;
  const link = pair.link;
  if (link?.billingStatement === false) return false;
  if (parent?.communicationBilling === false) return false;
  if (parent?.communicationByEmail === false) return false;
  return Boolean(String(parent?.email || "").trim());
}

function contactScore(pair: { parent: any; link: any }): number {
  let score = 0;
  if (pair.link?.isPrimary) score += 10;
  if (pair.link?.isPayingPerson) score += 6;
  if (pair.parent?.communicationBilling !== false) score += 2;
  return score;
}

/** Linked parent/guardian for statement email (billing + email flags). */
export function resolveStatementBillingContact(
  learners: any[],
  globalParents: any[],
  accountLearnerIds: string[]
): StatementContact | null {
  const ids = accountLearnerIds.filter(Boolean);
  const candidates: { parent: any; link: any }[] = [];

  for (const learnerId of ids) {
    const learner = (learners || []).find(
      (l) => String(l?.id || l?.learnerId) === learnerId
    );
    if (!learner) continue;
    for (const pair of collectParentPairsForLearner(learner, globalParents)) {
      if (isStatementBillingContact(pair)) candidates.push(pair);
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => contactScore(b) - contactScore(a));
  const best = candidates[0];
  return {
    name: parentDisplayName(best.parent),
    email: String(best.parent.email || "").trim(),
    relationship: String(best.link?.relation || best.link?.relationship || best.parent?.relationship || "Parent"),
  };
}

export { absolutizeSchoolLogoUrl, resolveSchoolLogoUrl } from "../utils/schoolLogo";

export async function loadStatementSchoolBranding(schoolId: string): Promise<StatementSchoolBranding> {
  const fallbackName = String(localStorage.getItem("schoolName") || "School").trim() || "School";
  if (!schoolId) {
    return { name: fallbackName };
  }
  try {
    const res = await fetch(`${API_URL}/api/schools/${encodeURIComponent(schoolId)}`);
    if (!res.ok) throw new Error("Failed to load school branding");
    const match = (await res.json()) as Record<string, unknown>;
    const logoUrl = resolveSchoolLogoUrl({ logoUrl: String(match.logoUrl || "").trim() || null });
    if (logoUrl) cacheSchoolLogoUrl(logoUrl);
    return {
      name: String(match.name || fallbackName).trim() || fallbackName,
      email: String(match.email || "").trim() || undefined,
      phone: String(match.phone || match.cellNo || match.telephone || "").trim() || undefined,
      address: String(match.address || match.physicalAddress || "").trim() || undefined,
      logoUrl: logoUrl || undefined,
    };
  } catch {
    return { name: fallbackName };
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
};

const PDF_INK: [number, number, number] = [17, 24, 39];
const PDF_MUTED: [number, number, number] = [107, 114, 128];
const PDF_GOLD: [number, number, number] = [212, 175, 55];
/** ~100×100 CSS px for HTML; server PDF uses the equivalent 100 pt box. */
export const STATEMENT_LOGO_PX = 100;
/** Matches server PDF logo box (100 pt). */
const STATEMENT_LOGO_MAX_MM = (100 * 25.4) / 72;
const STATEMENT_LOGO_GAP_MM = 4;
export const STATEMENT_LOGO_IMG_STYLE = `display:block;width:${STATEMENT_LOGO_PX}px;height:${STATEMENT_LOGO_PX}px;max-width:${STATEMENT_LOGO_PX}px;max-height:${STATEMENT_LOGO_PX}px;object-fit:contain;margin:0 0 10px 0`;

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

/** Builds a valid PDF (jsPDF) matching the account statement layout used for email attachments. */
export function generateAccountStatementPdf(input: AccountStatementDocumentInput): jsPDF {
  const { school, accountNo, accountLabel, children, contact, period, statementDate, balance, transactions, statementNote, isFamilyAccount } =
    input;
  const doc = new jsPDF({
    orientation: isFamilyAccount ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageH - 16) return;
    doc.addPage();
    y = margin;
  };

  doc.setFillColor(...PDF_INK);
  doc.rect(0, 0, pageW, 7, "F");
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, 7, pageW, 1.2, "F");

  if (school.logoUrl) {
    const logoAdvance = embedStatementLogoInPdf(doc, school.logoUrl, margin, y);
    if (logoAdvance > 0) y += logoAdvance;
  }

  doc.setTextColor(...PDF_INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(String(school.name || "School").trim() || "School", margin, y + 10);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("STATEMENT", pageW - margin, y + 10, { align: "right" });
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_MUTED);
  const schoolLines: string[] = [];
  if (school.address) schoolLines.push(String(school.address));
  const contactLine = [school.email, school.phone].filter(Boolean).join(" | ");
  if (contactLine) schoolLines.push(contactLine);
  for (const line of schoolLines) {
    ensureSpace(5);
    doc.text(line, margin, y);
    y += 4.5;
  }

  ensureSpace(14);
  doc.setTextColor(...PDF_MUTED);
  doc.text(`Account: ${accountNo}`, pageW - margin, y, { align: "right" });
  y += 4.5;
  doc.text(`Period: ${period}`, pageW - margin, y, { align: "right" });
  y += 4.5;
  doc.text(`Date: ${statementDate}`, pageW - margin, y, { align: "right" });
  y += 8;

  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  const boxH = 28;
  ensureSpace(boxH + 4);
  const boxW = (contentW - 6) / 2;
  doc.setDrawColor(229, 231, 235);
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(margin, y, boxW, boxH, 2, 2, "FD");
  doc.roundedRect(margin + boxW + 6, y, boxW, boxH, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_INK);
  doc.text("ACCOUNT", margin + 4, y + 7);
  doc.text("CONTACT", margin + boxW + 10, y + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  let boxY = y + 12;
  doc.text(`Account holder: ${accountLabel}`, margin + 4, boxY);
  boxY += 5;
  for (const child of children.slice(0, 3)) {
    doc.text(`${child.name} · Grade ${child.grade}`, margin + 4, boxY);
    boxY += 4.5;
  }
  if (children.length > 3) {
    doc.text(`+${children.length - 3} more learner(s)`, margin + 4, boxY);
  }

  const contactName = contact?.name || accountLabel;
  const contactEmail = contact?.email || "—";
  const contactRel = contact?.relationship || "Parent";
  doc.text(`Name: ${contactName}`, margin + boxW + 10, y + 12);
  doc.text(`Email: ${contactEmail}`, margin + boxW + 10, y + 17);
  doc.text(`Relationship: ${contactRel}`, margin + boxW + 10, y + 22);
  y += boxH + 10;

  const headers = isFamilyAccount
    ? ["Date", "Type", "Learner", "Reference", "Description", "In", "Out", "Balance"]
    : ["Date", "Type", "Reference", "Description", "In", "Out", "Balance"];
  const fixedCols = isFamilyAccount ? [22, 18, 28, 26, 22, 22, 28] : [24, 20, 30, 24, 24, 30];
  const descW = Math.max(28, contentW - fixedCols.reduce((sum, w) => sum + w, 0));
  const colWidths = isFamilyAccount
    ? [22, 18, 28, 26, descW, 22, 22, 28]
    : [24, 20, 30, descW, 24, 24, 30];

  const drawTableHeader = () => {
    doc.setFillColor(...PDF_INK);
    doc.rect(margin, y, contentW, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    let x = margin + 2;
    headers.forEach((label, i) => {
      const alignRight = i >= headers.length - 3;
      const w = colWidths[i];
      doc.text(label, alignRight ? x + w - 2 : x, y + 4.8, { align: alignRight ? "right" : "left" });
      x += w;
    });
    y += 7;
  };

  const ensureRowSpace = (needed: number) => {
    if (y + needed <= pageH - 16) return;
    doc.addPage();
    y = margin;
    drawTableHeader();
  };

  ensureSpace(10);
  drawTableHeader();

  const rowHeight = 6;
  const cellPad = 2;

  if (!transactions.length) {
    ensureRowSpace(rowHeight + 2);
    doc.setDrawColor(229, 231, 235);
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, y, contentW, rowHeight + 2, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text("No transactions for the selected period.", pageW / 2, y + 4.5, { align: "center" });
    y += rowHeight + 4;
  } else {
    transactions.forEach((row, index) => {
      ensureRowSpace(rowHeight + 2);
      if (index % 2 === 1) {
        doc.setFillColor(250, 248, 240);
        doc.rect(margin, y, contentW, rowHeight, "F");
      }
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, y + rowHeight, pageW - margin, y + rowHeight);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_INK);

      const values = isFamilyAccount
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

      let x = margin + cellPad;
      values.forEach((value, i) => {
        const w = colWidths[i] - cellPad * 2;
        const alignRight = i >= values.length - 3;
        const lines = doc.splitTextToSize(String(value || ""), w) as string[];
        const line = lines[0] || "";
        doc.text(line, alignRight ? x + w : x, y + 4.2, { align: alignRight ? "right" : "left" });
        x += colWidths[i];
      });
      y += rowHeight;
    });
  }

  ensureSpace(22);
  y += 6;
  const totalW = 72;
  const totalX = pageW - margin - totalW;
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.5);
  doc.roundedRect(totalX, y, totalW, 16, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(153, 27, 27);
  doc.text("Closing balance", totalX + 4, y + 8);
  doc.text(formatMoney(balance), totalX + totalW - 4, y + 8, { align: "right" });
  y += 22;

  if (statementNote) {
    ensureSpace(12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_INK);
    const noteLines = doc.splitTextToSize(String(statementNote), contentW) as string[];
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4.5 + 4;
  }

  ensureSpace(8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_MUTED);
  doc.text(`Statement generated for ${school.name || "School"} via EduClear.`, pageW / 2, pageH - 10, { align: "center" });

  return doc;
}

export function accountStatementToPdfBase64(input: AccountStatementDocumentInput): string {
  const doc = generateAccountStatementPdf(input);
  return pdfArrayBufferToBase64(doc.output("arraybuffer"));
}

export function buildAccountStatementHtml(input: AccountStatementDocumentInput): string {
  const { school, accountNo, accountLabel, children, contact, period, statementDate, balance, transactions, statementNote, isFamilyAccount } =
    input;

  const logoBlock = school.logoUrl
    ? `<img src="${escapeHtml(school.logoUrl)}" alt="" style="${STATEMENT_LOGO_IMG_STYLE}" />`
    : "";

  const childLines = children
    .map(
      (c) =>
        `<div>${escapeHtml(c.name)} <span style="color:#64748b;font-weight:600">· Grade ${escapeHtml(c.grade)}</span></div>`
    )
    .join("");

  const txRows = transactions.length
    ? transactions
        .map((row) => {
          const cols = [
            `<td>${escapeHtml(row.date)}</td>`,
            `<td>${escapeHtml(row.type)}</td>`,
            ...(isFamilyAccount ? [`<td>${escapeHtml(row.learner || "-")}</td>`] : []),
            `<td>${escapeHtml(row.reference)}</td>`,
            `<td>${escapeHtml(row.description)}</td>`,
            `<td style="text-align:right">${row.amountIn ? escapeHtml(formatMoney(row.amountIn)) : "-"}</td>`,
            `<td style="text-align:right">${row.amountOut ? escapeHtml(formatMoney(row.amountOut)) : "-"}</td>`,
            `<td style="text-align:right;font-weight:800">${escapeHtml(formatMoney(row.balance))}</td>`,
          ];
          return `<tr>${cols.join("")}</tr>`;
        })
        .join("")
    : `<tr><td colspan="${isFamilyAccount ? 8 : 7}" style="text-align:center;color:#64748b;padding:24px">No transactions for the selected period.</td></tr>`;

  const thead = isFamilyAccount
    ? "<tr><th>Date</th><th>Type</th><th>Learner</th><th>Reference</th><th>Description</th><th style=\"text-align:right\">Amount In</th><th style=\"text-align:right\">Amount Out</th><th style=\"text-align:right\">Balance</th></tr>"
    : "<tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th style=\"text-align:right\">Amount In</th><th style=\"text-align:right\">Amount Out</th><th style=\"text-align:right\">Balance</th></tr>";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Statement - ${escapeHtml(accountNo)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 32px; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #d4af37; padding-bottom: 18px; margin-bottom: 24px; gap: 20px; }
    .school-name { font-size: 26px; font-weight: 900; margin: 0 0 6px; }
    .muted { color: #6b7280; font-size: 12px; line-height: 1.5; }
    .title { text-align: right; font-size: 28px; font-weight: 900; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .box { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; background: #fafafa; }
    .box-title { font-size: 13px; font-weight: 900; margin-bottom: 8px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #111827; color: #fff; padding: 10px; font-size: 12px; text-align: left; }
    td { border: 1px solid #e5e7eb; padding: 10px; font-size: 12px; }
    .totals { margin-top: 18px; display: flex; justify-content: flex-end; }
    .total-box { width: 320px; border: 2px solid #d4af37; border-radius: 12px; padding: 14px; background: #fffbeb; }
    .closing { font-size: 18px; font-weight: 900; color: #991b1b; display: flex; justify-content: space-between; margin-top: 8px; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; text-align: center; }
    @media print { body { padding: 16px; } th, td { font-size: 11px; } }
    @media (max-width: 720px) {
      body { padding: 16px; }
      .header { flex-direction: column; }
      .title { text-align: left; margin-top: 12px; }
      .grid { grid-template-columns: 1fr; }
      table { display: block; width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      thead, tbody, tr { display: table; width: 100%; table-layout: fixed; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      ${logoBlock}
      <div class="school-name">${escapeHtml(school.name)}</div>
      <div class="muted">
        ${school.address ? `${escapeHtml(school.address)}<br />` : ""}
        ${school.email ? escapeHtml(school.email) : ""}
        ${school.phone ? ` | ${escapeHtml(school.phone)}` : ""}
      </div>
    </div>
    <div>
      <div class="title">STATEMENT</div>
      <div class="muted">
        Account: ${escapeHtml(accountNo)}<br />
        Period: ${escapeHtml(period)}<br />
        Date: ${escapeHtml(statementDate)}
      </div>
    </div>
  </div>
  <div class="grid">
    <div class="box">
      <div class="box-title">Account</div>
      <div><b>Account holder:</b> ${escapeHtml(accountLabel)}</div>
      ${children.length ? `<div style="margin-top:8px">${childLines}</div>` : ""}
    </div>
    <div class="box">
      <div class="box-title">Contact</div>
      <div><b>Name:</b> ${escapeHtml(contact?.name || accountLabel)}</div>
      <div><b>Email:</b> ${escapeHtml(contact?.email || "—")}</div>
      <div><b>Relationship:</b> ${escapeHtml(contact?.relationship || "Parent")}</div>
    </div>
  </div>
  <table>
    <thead>${thead}</thead>
    <tbody>${txRows}</tbody>
  </table>
  <div class="totals">
    <div class="total-box">
      <div class="closing"><span>Closing balance</span><span>${escapeHtml(formatMoney(balance))}</span></div>
    </div>
  </div>
  ${statementNote ? `<p style="margin-top:20px;line-height:1.5;white-space:pre-wrap">${escapeHtml(statementNote)}</p>` : ""}
  <div class="footer">Statement generated for ${escapeHtml(school.name)} via EduClear.</div>
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
  statementNote?: string
): Promise<Blob> {
  const params = new URLSearchParams({
    schoolId,
    learnerId,
    period: normalizeStatementPeriod(period),
  });
  if (statementNote) params.set("statementNote", statementNote);
  const res = await fetch(`${API_URL}/api/statements/pdf?${params.toString()}`);
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
  statementNote?: string
): Promise<void> {
  const blob = await fetchSchoolStatementPdfBlob(schoolId, learnerId, period, statementNote);
  triggerBlobDownload(blob, filename);
}

export async function openSchoolStatementPdfPrint(
  schoolId: string,
  learnerId: string,
  period = DEFAULT_STATEMENT_PERIOD,
  statementNote?: string
): Promise<boolean> {
  const blob = await fetchSchoolStatementPdfBlob(schoolId, learnerId, period, statementNote);
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

export async function fetchParentStatementPdfBlob(learnerId: string, token: string): Promise<Blob> {
  const params = new URLSearchParams({ learnerId });
  const res = await fetch(`${API_URL}/api/parent-portal/billing/statement.pdf?${params.toString()}`, {
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
  token: string
): Promise<void> {
  const blob = await fetchParentStatementPdfBlob(learnerId, token);
  triggerBlobDownload(blob, filename);
}

export async function openParentStatementPdfPrint(learnerId: string, token: string): Promise<boolean> {
  const blob = await fetchParentStatementPdfBlob(learnerId, token);
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
  learnerId: string;
  period?: string;
  statementNote?: string;
  filename?: string;
}): Promise<{ messageId?: string }> {
  const response = await fetch(`${API_URL}/api/emails/send-statement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
