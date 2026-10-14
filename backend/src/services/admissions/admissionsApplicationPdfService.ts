/**
 * Staff "Print / Download Application" — A4 PDF of a stored admissions application.
 * Read-only: never changes application, payment, learner or billing state.
 * Prints only stored values; anything absent is shown as "Not provided".
 */
import fs from "fs/promises";
import path from "path";

import type { PrismaClient } from "@prisma/client";
import PDFDocument from "pdfkit";

import { loadSchoolLogoBuffer } from "../../utils/schoolLogo";
import { resolveAdmissionsStorageRoot } from "./admissionsDocumentService";
import { parseRequiredDocumentConfig } from "./requiredDocumentConfig";
import {
  getStaffApplicationDetail,
  StaffAdmissionsError,
  type StaffApplicationDetail,
} from "./staffAdmissionsReadService";

const INK = "#111827";
const MUTED = "#6b7280";
const GOLD = "#d4af37";
const RULE = "#e5e7eb";
const NOTICE_BG = "#faf8f0";
const PAGE_MARGIN = 48;
const HEADER_BAR_H = 6;
const FOOTER_H = 28;
const LOGO_MAX = 56;
const LABEL_W = 150;
const NOT_PROVIDED = "Not provided";

export type ApplicationPdfSchool = {
  name: string;
  address: string | null;
  postalAddress: string | null;
  phone: string | null;
  cellNo: string | null;
  email: string | null;
  logo: Buffer | null;
};

export type ApplicationPdfDocumentRow = {
  label: string;
  documentType: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
};

export type ApplicationPdfChecklistRow = {
  label: string;
  status: "Uploaded" | "Missing" | "Not applicable" | "Not uploaded";
  required: boolean;
};

export type ApplicationPdfModel = {
  generatedAt: Date;
  school: ApplicationPdfSchool;
  detail: StaffApplicationDetail;
  medicalIncluded: boolean;
  acceptedAt: string | null;
  acceptedByName: string | null;
  declinedAt: string | null;
  acceptedWithPaymentPending: boolean;
  actorNames: Record<string, string>;
  signatureImages: Array<{ kind: string; image: Buffer }>;
  checklist: ApplicationPdfChecklistRow[];
  documents: ApplicationPdfDocumentRow[];
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function orNotProvided(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  return s || NOT_PROVIDED;
}

const DATE_FMT = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "short",
  day: "2-digit",
});
const DATE_TIME_FMT = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatPdfDate(value: string | Date | null | undefined): string {
  if (!value) return NOT_PROVIDED;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return NOT_PROVIDED;
  return DATE_FMT.format(d);
}

export function formatPdfDateTime(value: string | Date | null | undefined): string {
  if (!value) return NOT_PROVIDED;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return NOT_PROVIDED;
  return DATE_TIME_FMT.format(d);
}

function isWinAnsiChar(ch: string): boolean {
  const c = ch.codePointAt(0) || 0;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || c === 0x0a || "–—‘’“”•…€·".includes(ch);
}

/**
 * Standard PDF fonts only encode WinAnsi. Accented letters outside it lose the accent
 * (e.g. "ş" → "s"); anything else becomes "?" so nothing renders as garbage.
 */
export function pdfSafeText(text: string): string {
  return Array.from(String(text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, " "))
    .map((ch) => {
      if (isWinAnsiChar(ch)) return ch;
      const stripped = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      if (stripped && Array.from(stripped).every(isWinAnsiChar)) return stripped;
      return "?";
    })
    .join("");
}

function humanize(value: string | null | undefined): string {
  const s = clean(value);
  if (!s) return NOT_PROVIDED;
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function documentTypeLabel(documentType: string, labels: Map<string, string>): string {
  if (documentType === "proof_of_payment") return "Proof of payment";
  return labels.get(documentType) || humanize(documentType);
}

export function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return NOT_PROVIDED;
  if (typeof value === "string") return value.trim() || NOT_PROVIDED;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => formatAnswerValue(v)).filter((v) => v !== NOT_PROVIDED);
    return parts.length ? parts.join(", ") : NOT_PROVIDED;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanize(k)}: ${formatAnswerValue(v)}`)
      .filter(Boolean);
    return entries.length ? entries.join("; ") : NOT_PROVIDED;
  }
  return NOT_PROVIDED;
}

function money(currency: string | null | undefined, amount: string | null | undefined): string {
  if (!amount) return NOT_PROVIDED;
  const cur = clean(currency) || "ZAR";
  const prefix = cur === "ZAR" ? "R " : `${cur} `;
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${prefix}${amount}`;
  return `${prefix}${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return NOT_PROVIDED;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function schoolContactLines(school: ApplicationPdfSchool): string[] {
  const split = (v: string | null) =>
    String(v || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  const lines = split(school.address);
  const postal = split(school.postalAddress);
  if (postal.length && postal.join("|") !== lines.join("|")) lines.push(...postal);
  if (school.phone) lines.push(`Tel: ${school.phone}`);
  if (school.cellNo) lines.push(`Cell: ${school.cellNo}`);
  if (school.email) lines.push(school.email);
  return lines;
}

/**
 * Fee due / proof uploaded / payment verified are always three separate statements so a
 * printed application can never be read as a payment confirmation.
 */
export function paymentSummaryLines(detail: StaffApplicationDetail): Array<[string, string]> {
  const p = detail.payment;
  const required = Boolean(p?.required ?? detail.feeRequired);
  if (!required) {
    return [["Admission fee", "Not required"]];
  }
  const status = String(p?.paymentStatus || "AWAITING_PAYMENT");
  const proof = p?.proofDocument;
  const rows: Array<[string, string]> = [
    ["Admission fee due", money(p?.currency, p?.amount ?? detail.feeAmount)],
    ["Payment reference", orNotProvided(p?.paymentReference ?? detail.applicationNumber)],
    [
      "Proof of payment uploaded",
      p?.proofUploaded
        ? proof
          ? `Yes — ${formatPdfDateTime(proof.uploadedAt)}`
          : "Yes"
        : "No",
    ],
  ];
  let verification: string;
  switch (status) {
    case "VERIFIED":
      verification = `Verified — receipt of funds confirmed ${formatPdfDateTime(p?.verifiedAt)}`;
      break;
    case "WAIVED":
      verification = `Fee waived ${formatPdfDateTime(p?.waivedAt)}${p?.waiveReason ? ` — ${p.waiveReason}` : ""} (not a payment)`;
      break;
    case "REJECTED":
      verification = `Proof rejected ${formatPdfDateTime(p?.rejectedAt)}${p?.rejectionReason ? ` — ${p.rejectionReason}` : ""}. Fee outstanding.`;
      break;
    case "PROOF_UPLOADED":
    case "UNDER_VERIFICATION":
      verification = "NOT VERIFIED — receipt of funds has not been confirmed";
      break;
    default:
      verification = "NOT PAID — no proof of payment uploaded";
  }
  rows.push(["Payment verification", verification]);
  rows.push(["Payment status", humanize(status)]);
  return rows;
}

type Doc = InstanceType<typeof PDFDocument>;

class Writer {
  readonly doc: Doc;
  readonly contentW: number;
  private readonly left: number;

  constructor(doc: Doc) {
    this.doc = doc;
    this.left = PAGE_MARGIN;
    this.contentW = doc.page.width - PAGE_MARGIN * 2;
  }

  get bottom(): number {
    return this.doc.page.height - PAGE_MARGIN - FOOTER_H;
  }

  ensure(height: number) {
    if (this.doc.y + height > this.bottom) {
      this.doc.addPage();
    }
  }

  section(rawTitle: string) {
    const title = pdfSafeText(rawTitle);
    this.ensure(48);
    this.doc.y += 8;
    const y = this.doc.y;
    this.doc.font("Helvetica-Bold").fontSize(11).fillColor(INK);
    this.doc.text(title.toUpperCase(), this.left, y, { width: this.contentW, characterSpacing: 0.4 });
    const lineY = this.doc.y + 2;
    this.doc.strokeColor(GOLD).lineWidth(1).moveTo(this.left, lineY).lineTo(this.left + this.contentW, lineY).stroke();
    this.doc.y = lineY + 6;
  }

  subheading(rawTitle: string) {
    const title = pdfSafeText(rawTitle);
    this.ensure(30);
    this.doc.y += 4;
    this.doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK);
    this.doc.text(title, this.left, this.doc.y, { width: this.contentW });
    this.doc.y += 2;
  }

  row(rawLabel: string, rawValue: string) {
    const label = pdfSafeText(rawLabel);
    const value = pdfSafeText(rawValue);
    const valueW = this.contentW - LABEL_W;
    this.doc.font("Helvetica").fontSize(9);
    const valueH = this.doc.heightOfString(value, { width: valueW });
    this.doc.font("Helvetica-Bold").fontSize(8.5);
    const labelH = this.doc.heightOfString(label, { width: LABEL_W - 8 });
    const h = Math.max(valueH, labelH);
    if (h > this.bottom - (this.doc.page.margins.top + 20)) {
      // Value taller than a page: print label then let the value flow across pages.
      this.ensure(labelH + 14);
      const y = this.doc.y;
      this.doc.fillColor(MUTED).text(label, this.left, y, { width: this.contentW });
      this.doc.font("Helvetica").fontSize(9).fillColor(INK);
      this.doc.text(value, this.left, this.doc.y + 2, { width: this.contentW });
      this.doc.y += 4;
      return;
    }
    this.ensure(h + 6);
    const y = this.doc.y;
    this.doc.fillColor(MUTED).text(label, this.left, y, { width: LABEL_W - 8 });
    this.doc.font("Helvetica").fontSize(9).fillColor(INK);
    this.doc.text(value, this.left + LABEL_W, y, { width: valueW });
    this.doc.y = y + h + 4;
    this.doc.strokeColor(RULE).lineWidth(0.5)
      .moveTo(this.left, this.doc.y - 2).lineTo(this.left + this.contentW, this.doc.y - 2).stroke();
  }

  paragraph(rawText: string, opts: { size?: number; color?: string; bold?: boolean } = {}) {
    const text = pdfSafeText(rawText);
    this.doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 9).fillColor(opts.color ?? INK);
    this.ensure(Math.min(this.doc.heightOfString(text, { width: this.contentW }), 40) + 4);
    this.doc.text(text, this.left, this.doc.y, { width: this.contentW, lineGap: 1 });
    this.doc.y += 4;
  }

  notice(rawText: string) {
    const text = pdfSafeText(rawText);
    this.doc.font("Helvetica-Bold").fontSize(9);
    const h = this.doc.heightOfString(text, { width: this.contentW - 20 }) + 14;
    this.ensure(h + 6);
    const y = this.doc.y;
    this.doc.save();
    this.doc.rect(this.left, y, this.contentW, h).fill(NOTICE_BG);
    this.doc.rect(this.left, y, 3, h).fill(GOLD);
    this.doc.restore();
    this.doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
    this.doc.text(text, this.left + 12, y + 7, { width: this.contentW - 20 });
    this.doc.y = y + h + 6;
  }

  image(buffer: Buffer, fit: [number, number], caption: string) {
    this.ensure(fit[1] + 18);
    const y = this.doc.y;
    try {
      this.doc.image(buffer, this.left + LABEL_W, y, { fit });
      this.doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text(caption, this.left, y, { width: LABEL_W - 8 });
      this.doc.y = y + fit[1] + 8;
    } catch {
      this.row(caption, "Signature image could not be rendered");
    }
  }
}

function applicationRef(detail: StaffApplicationDetail): string {
  return detail.applicationNumber || "Not yet allocated (draft)";
}

type PdfTextStyle = { font: string | null; size: number; fill: unknown[] | null };

function captureTextStyle(doc: Doc): PdfTextStyle {
  const d = doc as unknown as { _font?: { name?: string } | null; _fontSize?: number; _fillColor?: unknown[] };
  return {
    font: d._font?.name ?? null,
    size: Number(d._fontSize) || 9,
    fill: Array.isArray(d._fillColor) ? [...d._fillColor] : null,
  };
}

function restoreTextStyle(doc: Doc, style: PdfTextStyle) {
  if (style.font) doc.font(style.font);
  doc.fontSize(style.size);
  if (style.fill) (doc.fillColor as (...args: unknown[]) => Doc)(...style.fill);
}

/**
 * Draws the continuation header on every auto-added page. Text flowing across the page break
 * (e.g. long agreement terms) must keep its own font, size and colour afterwards.
 */
export function installContinuationHeader(
  doc: Doc,
  drawPageChrome: () => void,
  headerText: string,
  width: number
) {
  doc.on("pageAdded", () => {
    const style = captureTextStyle(doc);
    drawPageChrome();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
    doc.text(headerText, PAGE_MARGIN, PAGE_MARGIN - 18, { width, lineBreak: false });
    restoreTextStyle(doc, style);
    doc.x = PAGE_MARGIN;
    doc.y = PAGE_MARGIN + 10;
  });
}

/** Pure renderer — no DB / filesystem access. */
export async function renderApplicationPdf(model: ApplicationPdfModel): Promise<Buffer> {
  const { detail, school } = model;
  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margins: { top: PAGE_MARGIN + 10, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: `Admission application ${detail.applicationNumber || ""}`.trim(),
      Author: school.name,
      Subject: "Admission application",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const w = new Writer(doc);
  const ref = pdfSafeText(applicationRef(detail));
  const schoolName = pdfSafeText(clean(school.name) || "School");

  const drawPageChrome = () => {
    doc.save();
    doc.rect(0, 0, doc.page.width, HEADER_BAR_H).fill(INK);
    doc.rect(0, HEADER_BAR_H, doc.page.width, 2).fill(GOLD);
    doc.restore();
  };
  drawPageChrome();
  installContinuationHeader(doc, drawPageChrome, `${schoolName} · Admission application ${ref} (continued)`, w.contentW);

  // Header
  let leftY = PAGE_MARGIN - 8;
  const leftW = w.contentW * 0.58;
  const rightX = PAGE_MARGIN + leftW + 10;
  const rightW = w.contentW - leftW - 10;
  if (school.logo) {
    try {
      doc.image(school.logo, PAGE_MARGIN, leftY, { fit: [LOGO_MAX, LOGO_MAX] });
      leftY += LOGO_MAX + 6;
    } catch {
      // Logo is optional branding; the document remains valid without it.
    }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(schoolName, PAGE_MARGIN, leftY, { width: leftW });
  leftY = doc.y + 2;
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  for (const line of schoolContactLines(school)) {
    doc.text(pdfSafeText(line), PAGE_MARGIN, leftY, { width: leftW });
    leftY = doc.y + 1;
  }

  let rightY = PAGE_MARGIN - 8;
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text("ADMISSION APPLICATION", rightX, rightY, {
    width: rightW,
    align: "right",
  });
  rightY = doc.y + 4;
  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  for (const line of [
    `Reference: ${ref}`,
    `Intake year: ${detail.intakeYear}`,
    `Status: ${humanize(detail.status)}`,
    `Submitted: ${detail.submittedAt ? formatPdfDateTime(detail.submittedAt) : "Not submitted"}`,
    `Printed: ${formatPdfDateTime(model.generatedAt)}`,
  ]) {
    doc.text(pdfSafeText(line), rightX, rightY, { width: rightW, align: "right" });
    rightY = doc.y + 1;
  }
  doc.y = Math.max(leftY, rightY) + 8;
  doc.strokeColor(GOLD).lineWidth(1.5).moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + w.contentW, doc.y).stroke();
  doc.y += 8;

  if (model.acceptedWithPaymentPending && detail.payment?.paymentStatus !== "VERIFIED") {
    w.notice(
      "Accepted with payment verification pending. Acceptance does not confirm payment; receipt of funds must be verified separately."
    );
  }

  // Application
  w.section("Application");
  w.row("Application reference", ref);
  w.row("Intake year", String(detail.intakeYear));
  w.row("Grade applied for", orNotProvided(detail.requestedGrade));
  w.row("Application status", humanize(detail.status));
  w.row("Submitted", detail.submittedAt ? formatPdfDateTime(detail.submittedAt) : "Not submitted");

  // Learner
  w.section("Learner details");
  const l = detail.learner;
  if (!l) {
    w.paragraph(NOT_PROVIDED, { color: MUTED });
  } else {
    w.row("First name", orNotProvided(l.firstName));
    w.row("Surname", orNotProvided(l.lastName));
    w.row("Preferred name", orNotProvided(l.nickname));
    w.row("Date of birth", l.birthDate ? formatPdfDate(l.birthDate) : NOT_PROVIDED);
    w.row("Gender", orNotProvided(l.gender));
    w.row("ID / passport number", orNotProvided(l.idNumber));
    w.row("Citizenship", orNotProvided(l.citizenship));
    w.row("Home language", orNotProvided(l.homeLanguage));
    w.row("Home address", orNotProvided(l.homeAddress));
    w.row("Previous school", orNotProvided(l.previousSchoolName));
    if (model.medicalIncluded) {
      w.row("Allergies", orNotProvided(l.allergies));
      w.row("Medical alert", orNotProvided(l.medicalAlert));
      w.row("Medical / other notes", orNotProvided(l.notes));
    } else {
      w.row("Medical information", "Withheld — requires admissions manage permission");
    }
  }

  // Guardians
  w.section("Parents / guardians");
  if (!detail.guardians.length) {
    w.paragraph(NOT_PROVIDED, { color: MUTED });
  }
  detail.guardians.forEach((g, idx) => {
    const roles = [g.isPrimary ? "Primary contact" : null, g.isPayingPerson ? "Responsible for fees" : null]
      .filter(Boolean)
      .join(" · ");
    w.subheading(
      `Guardian ${idx + 1}: ${[clean(g.title), clean(g.firstName), clean(g.surname)].filter(Boolean).join(" ") || NOT_PROVIDED}`
    );
    w.row("Relationship to learner", orNotProvided(g.relationship));
    if (roles) w.row("Role", roles);
    w.row("ID / passport number", orNotProvided(g.idNumber));
    w.row("Cell number", orNotProvided(g.cellNo));
    w.row("Email", orNotProvided(g.email));
    w.row("Residential address", orNotProvided(g.homeAddress));
    w.row("Employer", orNotProvided(g.employer));
  });

  w.section("Family declarations");
  w.row("Existing sibling at school", detail.declaredExistingSibling ? "Yes" : "No");
  if (detail.declaredExistingSibling) {
    w.row("Sibling name", orNotProvided(detail.declaredSiblingLearnerName));
    w.row("Sibling admission number", orNotProvided(detail.declaredSiblingAdmissionNo));
  }
  w.row("Existing family account", detail.declaredExistingFamily ? "Yes" : "No");

  // Questions
  w.section("Additional questions");
  if (!detail.answers.length) {
    w.paragraph("No additional questions were answered.", { color: MUTED });
  }
  for (const a of detail.answers) {
    w.row(orNotProvided(a.questionLabelSnapshot || a.questionKey), formatAnswerValue(a.valueJson));
  }

  // Consents
  w.section("Declarations and consent");
  w.row(
    "Privacy notice",
    detail.privacyAcceptedAt
      ? `Accepted ${formatPdfDateTime(detail.privacyAcceptedAt)}${detail.privacyNoticeVersion ? ` (version ${detail.privacyNoticeVersion})` : ""}`
      : "Not accepted"
  );
  w.row(
    "Applicant declarations",
    detail.declarationsAcceptedAt ? `Accepted ${formatPdfDateTime(detail.declarationsAcceptedAt)}` : "Not accepted"
  );

  // Financial agreement
  w.section("Financial agreement");
  const fa = detail.financialAgreement;
  if (!fa.required) {
    w.paragraph(fa.notRequiredMessage || "Financial agreement was not required.", { color: MUTED });
  } else if (!fa.acceptances.length) {
    w.paragraph("No signed financial agreement is stored for this application.", { color: MUTED });
  }
  for (const acc of fa.acceptances) {
    w.subheading(`${acc.title}${acc.version ? ` — version ${acc.version}` : ""}`);
    w.row("Document type", humanize(acc.kind));
    w.row("Signed by", orNotProvided(acc.signerFullName));
    w.row("Typed signature", orNotProvided(acc.typedSignerName));
    w.row("Accepted", formatPdfDateTime(acc.acceptedAt));
    w.row("Signed", formatPdfDateTime(acc.signedAt));
    w.row("Document fingerprint (SHA-256)", orNotProvided(acc.contentSha256));
    const sig = model.signatureImages.find((s) => s.kind === acc.kind);
    if (sig) {
      w.image(sig.image, [200, 70], "Signature");
    } else {
      w.row("Signature image", fa.signatureAvailable ? "Stored but unavailable for printing" : "Not captured");
    }
    w.paragraph("Accepted terms:", { bold: true, size: 8.5, color: MUTED });
    w.paragraph(orNotProvided(acc.body), { size: 8 });
  }

  // Fee & payment
  w.section("Admission fee and payment");
  for (const [label, value] of paymentSummaryLines(detail)) {
    w.row(label, value);
  }
  if (detail.status === "ACCEPTED" && detail.payment?.paymentStatus !== "VERIFIED" && detail.payment?.required) {
    w.paragraph("Acceptance does not confirm payment.", { bold: true, size: 8.5 });
  }

  // Documents
  w.section("Supporting documents");
  if (model.checklist.length) {
    w.subheading("Required documents checklist");
    for (const c of model.checklist) {
      w.row(c.label, c.status);
    }
  }
  w.subheading(`Uploaded files (${model.documents.length})`);
  if (!model.documents.length) {
    w.paragraph("No documents uploaded.", { color: MUTED });
  }
  for (const d of model.documents) {
    w.row(
      d.label,
      `${d.originalFileName}\n${d.contentType} · ${formatBytes(d.byteSize)} · uploaded ${formatPdfDateTime(d.uploadedAt)}`
    );
  }

  // Staff review
  w.section("Staff review and decision");
  const actor = (id: string | null, type: string) =>
    id ? model.actorNames[id] || "Staff member" : type === "APPLICANT" ? "Applicant" : type === "SYSTEM" ? "System" : "Staff member";
  if (detail.status === "ACCEPTED") {
    w.row("Decision", "Accepted");
    w.row("Accepted on", formatPdfDateTime(model.acceptedAt));
    w.row("Accepted by", orNotProvided(model.acceptedByName));
  } else if (detail.status === "DECLINED") {
    w.row("Decision", "Declined");
    w.row("Declined on", formatPdfDateTime(model.declinedAt));
    w.row("Reason", orNotProvided(detail.statusReason));
  } else {
    w.row("Decision", "No final decision recorded");
    if (detail.statusReason) w.row("Latest status note", detail.statusReason);
  }
  if (detail.statusHistory.length) {
    w.subheading("Status history");
    for (const h of detail.statusHistory) {
      w.row(
        formatPdfDateTime(h.createdAt),
        `${h.fromStatus ? `${humanize(h.fromStatus)} » ` : ""}${humanize(h.toStatus)} · ${actor(h.actorUserId, h.actorType)}${h.reason ? `\n${h.reason}` : ""}`
      );
    }
  }
  if (detail.paymentHistory.length) {
    w.subheading("Payment history");
    for (const h of detail.paymentHistory) {
      w.row(
        formatPdfDateTime(h.createdAt),
        `${h.fromStatus ? `${humanize(h.fromStatus)} » ` : ""}${humanize(h.toStatus)} · ${actor(h.actorUserId, h.actorType)}${h.reason ? `\n${h.reason}` : ""}`
      );
    }
  }

  // Footers with page numbers (requires bufferPages).
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - PAGE_MARGIN + 8;
    doc.strokeColor(RULE).lineWidth(0.5).moveTo(PAGE_MARGIN, fy - 6).lineTo(doc.page.width - PAGE_MARGIN, fy - 6).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(`${schoolName} · ${ref} · Confidential`, PAGE_MARGIN, fy, {
      width: w.contentW * 0.7,
      lineBreak: false,
    });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE_MARGIN + w.contentW * 0.7, fy, {
      width: w.contentW * 0.3,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  const buffer = await done;
  if (!buffer.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
    throw new Error("Application PDF generation failed");
  }
  return buffer;
}

async function readSignatureImage(signatureFileKey: string | null): Promise<Buffer | null> {
  const key = clean(signatureFileKey);
  if (!key || key.includes("..")) return null;
  const root = path.resolve(resolveAdmissionsStorageRoot());
  const absolutePath = path.resolve(root, ...key.split("/"));
  if (!absolutePath.startsWith(root + path.sep)) return null;
  try {
    return await fs.readFile(absolutePath);
  } catch {
    return null;
  }
}

/** Requirement order first, other types alphabetically, proof of payment last; oldest upload first. */
export function sortDocumentsForPrint<T extends { documentType: string; uploadedAt: string | Date }>(
  docs: T[],
  requiredOrder: string[]
): T[] {
  const rank = (t: string) => {
    if (t === "proof_of_payment") return 100000;
    const i = requiredOrder.indexOf(t);
    return i >= 0 ? i : 1000;
  };
  return [...docs].sort((a, b) => {
    const r = rank(a.documentType) - rank(b.documentType);
    if (r !== 0) return r;
    const t = a.documentType.localeCompare(b.documentType);
    if (t !== 0) return t;
    return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
  });
}

/** Loads a school-scoped print model. Throws 404 for other schools' applications. */
export async function loadApplicationPdfModel(
  prisma: PrismaClient,
  schoolId: string,
  applicationId: string,
  options: { includeMedicalDetails: boolean; now?: Date }
): Promise<ApplicationPdfModel> {
  const detail = await getStaffApplicationDetail(prisma, schoolId, applicationId, {
    includeMedicalDetails: options.includeMedicalDetails,
    includeStaffNotes: false,
  });

  const [school, settings, appRow, acceptances] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        name: true,
        address: true,
        postalAddress: true,
        phone: true,
        cellNo: true,
        email: true,
        logoUrl: true,
      },
    }),
    prisma.schoolAdmissionsSettings.findUnique({
      where: { schoolId },
      select: { requiredDocuments: true },
    }),
    prisma.admissionApplication.findFirst({
      where: { id: detail.id, schoolId },
      select: { acceptedAt: true, acceptedByUserId: true, declinedAt: true },
    }),
    prisma.admissionFinancialAcceptance.findMany({
      where: { schoolId, applicationId: detail.id },
      select: { kind: true, signatureFileKey: true },
    }),
  ]);
  if (!school || !appRow) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const actorIds = new Set<string>();
  if (appRow.acceptedByUserId) actorIds.add(appRow.acceptedByUserId);
  for (const h of [...detail.statusHistory, ...detail.paymentHistory]) {
    if (h.actorUserId) actorIds.add(h.actorUserId);
  }
  const users = actorIds.size
    ? await prisma.user.findMany({
        where: { id: { in: Array.from(actorIds) }, schoolId },
        select: { id: true, fullName: true },
      })
    : [];
  const actorNames: Record<string, string> = {};
  for (const u of users) {
    actorNames[u.id] = clean(u.fullName) || "Staff member";
  }

  const acceptedEvent = detail.auditTimeline
    .filter((e) => e.eventType === "APPLICATION_ACCEPTED")
    .pop();
  const acceptedMeta =
    acceptedEvent && acceptedEvent.metadataJson && typeof acceptedEvent.metadataJson === "object"
      ? (acceptedEvent.metadataJson as Record<string, unknown>)
      : null;

  const signatureImages: ApplicationPdfModel["signatureImages"] = [];
  for (const a of acceptances) {
    const image = await readSignatureImage(a.signatureFileKey);
    if (image) signatureImages.push({ kind: a.kind, image });
  }

  const requirements = parseRequiredDocumentConfig(settings?.requiredDocuments ?? []);
  const labels = new Map(requirements.map((r) => [r.key, r.label]));
  const uploaded = new Set(detail.documents.map((d) => d.documentType));
  const applicableRequired = new Set([
    ...detail.documentCompleteness.requiredDocumentTypes,
    ...detail.documentCompleteness.missingDocumentTypes,
  ]);
  const checklist: ApplicationPdfChecklistRow[] = requirements.map((r) => {
    let status: ApplicationPdfChecklistRow["status"];
    if (uploaded.has(r.key)) status = "Uploaded";
    else if (!r.required) status = "Not uploaded";
    else if (applicableRequired.has(r.key)) status = "Missing";
    else status = "Not applicable";
    return {
      label: `${r.label || humanize(r.key)}${r.required ? "" : " (optional)"}`,
      required: r.required,
      status,
    };
  });

  const documents = sortDocumentsForPrint(
    detail.documents,
    requirements.map((r) => r.key)
  ).map((d) => ({
    label: documentTypeLabel(d.documentType, labels),
    documentType: d.documentType,
    originalFileName: d.originalFileName,
    contentType: d.contentType,
    byteSize: d.byteSize,
    uploadedAt: d.uploadedAt,
  }));

  return {
    generatedAt: options.now ?? new Date(),
    school: {
      name: school.name,
      address: school.address,
      postalAddress: school.postalAddress,
      phone: school.phone,
      cellNo: school.cellNo,
      email: school.email,
      logo: await loadSchoolLogoBuffer(school.logoUrl),
    },
    detail,
    medicalIncluded: options.includeMedicalDetails,
    acceptedAt: appRow.acceptedAt ? appRow.acceptedAt.toISOString() : null,
    acceptedByName: appRow.acceptedByUserId ? actorNames[appRow.acceptedByUserId] || "Staff member" : null,
    declinedAt: appRow.declinedAt ? appRow.declinedAt.toISOString() : null,
    acceptedWithPaymentPending: Boolean(acceptedMeta?.paymentVerificationPending),
    actorNames,
    signatureImages,
    checklist,
    documents,
  };
}

/** Safe download base name, e.g. "APP-2027-000001". */
export function applicationFileBase(detail: { applicationNumber: string | null; id: string }): string {
  const raw = clean(detail.applicationNumber) || `application-${detail.id.slice(-8)}`;
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "application";
}
