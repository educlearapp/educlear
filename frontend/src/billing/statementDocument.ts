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
  cellNo?: string;
  address?: string;
  postalAddress?: string;
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
      phone: String(match.phone || match.telephone || "").trim() || undefined,
      cellNo: String(match.cellNo || "").trim() || undefined,
      address: String(match.address || match.physicalAddress || "").trim() || undefined,
      postalAddress: String(match.postalAddress || "").trim() || undefined,
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

function measureAccountBoxHeightMm(input: AccountStatementDocumentInput): number {
  const showLearnersList = input.isFamilyAccount || input.children.length > 1;
  if (showLearnersList) return 16 + 4 + input.children.length * 4;
  if (input.children.length === 1) return 16 + 4;
  return 16;
}

/** Builds a valid PDF (jsPDF) matching the account statement layout used for email attachments. */
export function generateAccountStatementPdf(input: AccountStatementDocumentInput): jsPDF {
  const { school, accountNo, accountLabel, children, contact, period, statementDate, balance, transactions, statementNote, isFamilyAccount } =
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
  const brandBarH = 5;
  const brandGoldH = 1;
  const topY = brandBarH + brandGoldH + 4;
  let y = topY;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageH - 12) return;
    doc.addPage();
    y = margin;
  };

  doc.setFillColor(...PDF_INK);
  doc.rect(0, 0, pageW, brandBarH, "F");
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, brandBarH, pageW, brandGoldH, "F");

  let leftY = topY;
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

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_MUTED);
  for (const line of schoolBrandingLines(school)) {
    const wrapped = doc.splitTextToSize(line, leftW);
    doc.text(wrapped, leftX, leftY);
    leftY += wrapped.length * 3.5 + 0.8;
  }

  let rightY = topY;
  doc.setTextColor(...PDF_INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("STATEMENT", rightX + rightW, rightY, { align: "right" });
  rightY += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_MUTED);
  doc.text(`Account: ${accountNo}`, rightX + rightW, rightY, { align: "right" });
  rightY += 3.8;
  doc.text(`Period: ${period}`, rightX + rightW, rightY, { align: "right" });
  rightY += 3.8;
  doc.text(`Date: ${statementDate}`, rightX + rightW, rightY, { align: "right" });
  rightY += 3.8;

  y = Math.max(leftY, rightY) + 4;

  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  const boxH = measureAccountBoxHeightMm(input);
  ensureSpace(boxH + 3);
  const boxW = (contentW - 4) / 2;
  doc.setDrawColor(229, 231, 235);
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(margin, y, boxW, boxH, 2, 2, "FD");
  doc.roundedRect(margin + boxW + 4, y, boxW, boxH, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_INK);
  doc.text("ACCOUNT", margin + 3, y + 5.5);
  doc.text("CONTACT", margin + boxW + 7, y + 5.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  let boxY = y + 9;
  doc.text(`Account holder: ${accountLabel}`, margin + 3, boxY);
  boxY += 4;
  const showLearnersList = isFamilyAccount || children.length > 1;
  if (showLearnersList) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("Learners:", margin + 3, boxY);
    boxY += 3.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const child of children) {
      doc.text(`– ${child.name} – Grade ${child.grade}`, margin + 3, boxY);
      boxY += 3.5;
    }
  } else if (children.length === 1) {
    const child = children[0];
    doc.text(`– ${child.name} – Grade ${child.grade}`, margin + 3, boxY);
  }

  const contactName = contact?.name || accountLabel;
  const contactEmail = contact?.email || "—";
  const contactRel = contact?.relationship || "Parent";
  doc.text(`Name: ${contactName}`, margin + boxW + 7, y + 9);
  doc.text(`Email: ${contactEmail}`, margin + boxW + 7, y + 13);
  doc.text(`Relationship: ${contactRel}`, margin + boxW + 7, y + 17);
  y += boxH + 6;

  const headers = isFamilyAccount
    ? ["Date", "Type", "Learner", "Reference", "Description", "Amount In", "Amount Out", "Running Balance"]
    : ["Date", "Type", "Reference", "Description", "Amount In", "Amount Out", "Running Balance"];
  const fixedCols = isFamilyAccount ? [20, 16, 24, 22, 20, 20, 24] : [22, 16, 24, 20, 20, 24];
  const descW = Math.max(24, contentW - fixedCols.reduce((sum, w) => sum + w, 0));
  const colWidths = isFamilyAccount
    ? [20, 16, 24, 22, descW, 20, 20, 24]
    : [22, 16, 24, descW, 20, 20, 24];

  const drawTableHeader = () => {
    doc.setFillColor(...PDF_INK);
    doc.rect(margin, y, contentW, 5.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    let x = margin + 1.5;
    headers.forEach((label, i) => {
      const alignRight = i >= headers.length - 3;
      const w = colWidths[i];
      doc.text(label, alignRight ? x + w - 1.5 : x, y + 3.8, { align: alignRight ? "right" : "left" });
      x += w;
    });
    y += 5.5;
  };

  const ensureRowSpace = (needed: number) => {
    if (y + needed <= pageH - 12) return;
    doc.addPage();
    y = margin;
    drawTableHeader();
  };

  ensureSpace(8);
  drawTableHeader();

  const rowHeight = 5;
  const cellPad = 1.5;

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
      doc.setFontSize(6.5);
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
        doc.text(line, alignRight ? x + w : x, y + 3.5, { align: alignRight ? "right" : "left" });
        x += colWidths[i];
      });
      y += rowHeight;
    });
  }

  ensureSpace(16);
  y += 4;
  const totalW = 62;
  const totalX = pageW - margin - totalW;
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.4);
  doc.roundedRect(totalX, y, totalW, 12, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(153, 27, 27);
  doc.text("Closing balance", totalX + 3, y + 6.5);
  doc.text(formatMoney(balance), totalX + totalW - 3, y + 6.5, { align: "right" });
  y += 16;

  if (statementNote) {
    ensureSpace(10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_INK);
    const noteLines = doc.splitTextToSize(String(statementNote), contentW) as string[];
    doc.text(noteLines, margin, y);
    y += noteLines.length * 3.8 + 3;
  }

  ensureSpace(6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_MUTED);
  doc.text(`Statement generated for ${school.name || "School"} via EduClear.`, pageW / 2, pageH - 8, { align: "center" });

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

  const showLearnersList = isFamilyAccount || children.length > 1;
  const childLines = showLearnersList
    ? `<div style="margin-top:8px;font-size:12px;font-weight:900;color:#64748b">Learners:</div><ul style="margin:6px 0 0;padding-left:18px">${children
        .map(
          (c) =>
            `<li>${escapeHtml(c.name)} <span style="color:#64748b;font-weight:600">– Grade ${escapeHtml(c.grade)}</span></li>`
        )
        .join("")}</ul>`
    : children.length === 1
      ? `<div style="margin-top:8px">${escapeHtml(children[0].name)} <span style="color:#64748b;font-weight:600">– Grade ${escapeHtml(children[0].grade)}</span></div>`
      : "";

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
    ? "<tr><th>Date</th><th>Type</th><th>Learner</th><th>Reference</th><th>Description</th><th style=\"text-align:right\">Amount In</th><th style=\"text-align:right\">Amount Out</th><th style=\"text-align:right\">Running Balance</th></tr>"
    : "<tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th style=\"text-align:right\">Amount In</th><th style=\"text-align:right\">Amount Out</th><th style=\"text-align:right\">Running Balance</th></tr>";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Statement - ${escapeHtml(accountNo)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 10mm 10mm 8mm; background: #fff; max-width: 210mm; box-sizing: border-box; font-size: 11px; }
    .brand-bar { height: 4px; background: #111827; margin: -10mm -10mm 0; }
    .brand-gold { height: 1px; background: #d4af37; margin: 0 -10mm 8px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #d4af37; padding-bottom: 10px; margin-bottom: 12px; gap: 16px; }
    .header-left { flex: 1 1 58%; min-width: 0; }
    .header-right { flex: 0 0 auto; text-align: right; }
    .school-name { font-size: 17px; font-weight: 900; margin: 0 0 4px; line-height: 1.2; }
    .muted { color: #6b7280; font-size: 10px; line-height: 1.45; }
    .muted p { margin: 0 0 3px; display: block; }
    .school-contact { display: flex; flex-direction: column; gap: 2px; }
    .title { font-size: 20px; font-weight: 900; margin: 0 0 6px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; background: #fafafa; }
    .box-title { font-size: 10px; font-weight: 900; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.03em; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
    th { background: #111827; color: #fff; padding: 5px 6px; font-size: 9px; text-align: left; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    td { border-bottom: 1px solid #e5e7eb; padding: 4px 6px; font-size: 9px; vertical-align: top; overflow: hidden; text-overflow: ellipsis; }
    tr:nth-child(even) td { background: #faf8f0; }
    .totals { margin-top: 10px; display: flex; justify-content: flex-end; }
    .total-box { width: 240px; border: 1.5px solid #d4af37; border-radius: 8px; padding: 8px 10px; background: #fffbeb; }
    .closing { font-size: 14px; font-weight: 900; color: #991b1b; display: flex; justify-content: space-between; gap: 12px; }
    .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #6b7280; text-align: center; }
    @media print { body { padding: 10mm; } th, td { font-size: 8.5px; } }
    @media (max-width: 720px) {
      body { padding: 12px; }
      .header { flex-direction: column; }
      .title { text-align: left; margin-top: 8px; }
      .grid { grid-template-columns: 1fr; }
      table { display: block; width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      thead, tbody, tr { display: table; width: 100%; table-layout: fixed; }
    }
  </style>
</head>
<body>
  <div class="brand-bar"></div>
  <div class="brand-gold"></div>
  <div class="header">
    <div class="header-left">
      ${logoBlock}
      <div class="school-name">${escapeHtml(school.name)}</div>
      <div class="muted school-contact">
        ${schoolBrandingLines(school)
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join("")}
      </div>
    </div>
    <div class="header-right">
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
  accountNo?: string
): Promise<Blob> {
  const params = new URLSearchParams({
    schoolId,
    period: normalizeStatementPeriod(period),
  });
  const billingRef = String(accountNo || "").trim();
  if (billingRef) params.set("accountNo", billingRef);
  if (learnerId) params.set("learnerId", learnerId);
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
  statementNote?: string,
  accountNo?: string
): Promise<void> {
  const key = ["school", schoolId, learnerId, normalizeStatementPeriod(period), accountNo || ""].join("|");
  return runSingleStatementPdfDownload(key, async () => {
    const blob = await fetchSchoolStatementPdfBlob(schoolId, learnerId, period, statementNote, accountNo);
    triggerBlobDownload(blob, filename);
  });
}

export async function openSchoolStatementPdfPrint(
  schoolId: string,
  learnerId: string,
  period = DEFAULT_STATEMENT_PERIOD,
  statementNote?: string,
  accountNo?: string
): Promise<boolean> {
  const blob = await fetchSchoolStatementPdfBlob(schoolId, learnerId, period, statementNote, accountNo);
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
  learnerId: string;
  accountNo?: string;
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
