/**
 * Staff application document packs: ZIP (originals + manifest), combined printable PDF,
 * and download audit events. Read-only for application/payment state.
 * Streams/buffers in memory only — no temporary files, no storage paths exposed.
 */
import fs from "fs/promises";
import { PassThrough, type Readable } from "stream";

import type { PrismaClient } from "@prisma/client";
import { PDFDocument as PdfLibDocument, StandardFonts, rgb } from "pdf-lib";
import yazl from "yazl";

import { resolveLocalAdmissionsDocumentFile } from "./admissionsDocumentService";
import { extensionForMime, type AdmissionsAllowedMime } from "./admissionsFileValidation";
import { documentTypeLabel, pdfSafeText, sortDocumentsForPrint } from "./admissionsApplicationPdfService";
import { parseRequiredDocumentConfig } from "./requiredDocumentConfig";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";

/** Combined PDF safety cap; attachments beyond this stay ZIP-only and are listed. */
export const COMBINED_PDF_MAX_ATTACHMENT_PAGES = 300;

export type PackDocument = {
  id: string;
  documentType: string;
  label: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: Date;
  uploadedBy: string;
  /** Safe archive-relative file name, e.g. "documents/01_birth_certificate.pdf". */
  packFileName: string;
  absolutePath: string | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeSegment(value: string, max = 48): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, max) || "file"
  );
}

function extensionFor(contentType: string, originalFileName: string): string {
  const known = ["application/pdf", "image/jpeg", "image/png"];
  if (known.includes(contentType)) return extensionForMime(contentType as AdmissionsAllowedMime);
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(originalFileName || "");
  return m ? `.${m[1].toLowerCase()}` : ".bin";
}

/** Active (non-deleted) documents for a school-owned application, in print order. */
export async function listPackDocuments(
  prisma: PrismaClient,
  schoolId: string,
  applicationId: string
): Promise<{ applicationNumber: string | null; applicationId: string; documents: PackDocument[] }> {
  const sid = clean(schoolId);
  const appId = clean(applicationId);
  if (!sid) throw new StaffAdmissionsError("School context required", 403, "SCHOOL_REQUIRED");
  const app = appId
    ? await prisma.admissionApplication.findFirst({
        where: { id: appId, schoolId: sid },
        select: { id: true, applicationNumber: true },
      })
    : null;
  if (!app) throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");

  const [rows, settings] = await Promise.all([
    prisma.admissionDocument.findMany({
      where: { applicationId: app.id, schoolId: sid, deletedAt: null },
      select: {
        id: true,
        documentType: true,
        originalFileName: true,
        contentType: true,
        byteSize: true,
        uploadedAt: true,
        uploadedBy: true,
        storageProvider: true,
        storageKey: true,
      },
    }),
    prisma.schoolAdmissionsSettings.findUnique({
      where: { schoolId: sid },
      select: { requiredDocuments: true },
    }),
  ]);
  const requirements = parseRequiredDocumentConfig(settings?.requiredDocuments ?? []);
  const labels = new Map(requirements.map((r) => [r.key, r.label]));
  const ordered = sortDocumentsForPrint(rows, requirements.map((r) => r.key));

  const documents: PackDocument[] = [];
  let n = 0;
  for (const row of ordered) {
    n += 1;
    let absolutePath: string | null = null;
    try {
      const file = resolveLocalAdmissionsDocumentFile(row);
      await fs.access(file.absolutePath);
      absolutePath = file.absolutePath;
    } catch {
      absolutePath = null;
    }
    const prefix = String(n).padStart(2, "0");
    documents.push({
      id: row.id,
      documentType: row.documentType,
      label: documentTypeLabel(row.documentType, labels),
      originalFileName: row.originalFileName,
      contentType: row.contentType,
      byteSize: row.byteSize,
      uploadedAt: row.uploadedAt,
      uploadedBy: String(row.uploadedBy),
      packFileName: `documents/${prefix}_${safeSegment(row.documentType)}${extensionFor(row.contentType, row.originalFileName)}`,
      absolutePath,
    });
  }
  return { applicationNumber: app.applicationNumber, applicationId: app.id, documents };
}

function csvCell(value: string): string {
  let v = value;
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function buildManifestCsv(input: {
  applicationRef: string;
  generatedAt: Date;
  includesApplicationPdf: string | null;
  documents: PackDocument[];
}): string {
  const header = [
    "file_in_pack",
    "category",
    "document_type",
    "original_file_name",
    "content_type",
    "size_bytes",
    "uploaded_at",
    "uploaded_by",
    "status",
  ];
  const lines = [header.map(csvCell).join(",")];
  if (input.includesApplicationPdf) {
    lines.push(
      [
        input.includesApplicationPdf,
        "Application form",
        "application_pdf",
        "",
        "application/pdf",
        "",
        input.generatedAt.toISOString(),
        "Generated by EduClear",
        "included",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  for (const d of input.documents) {
    lines.push(
      [
        d.absolutePath ? d.packFileName : "",
        d.label,
        d.documentType,
        d.originalFileName,
        d.contentType,
        String(d.byteSize),
        d.uploadedAt.toISOString(),
        d.uploadedBy === "STAFF" ? "Staff" : "Applicant",
        d.absolutePath ? "included" : "missing — stored file unavailable",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * Streams a ZIP containing the optional application PDF, every available original
 * document and manifest.csv. Missing files are recorded in the manifest, never silently dropped.
 */
export function createApplicationPackZipStream(input: {
  applicationRef: string;
  generatedAt: Date;
  applicationPdf: Buffer | null;
  documents: PackDocument[];
}): Readable {
  const zip = new yazl.ZipFile();
  const root = safeSegment(input.applicationRef, 60);
  const mtime = input.generatedAt;
  const pdfName = input.applicationPdf ? `${root}_application.pdf` : null;
  if (input.applicationPdf && pdfName) {
    zip.addBuffer(input.applicationPdf, `${root}/${pdfName}`, { mtime, compress: true });
  }
  for (const d of input.documents) {
    if (!d.absolutePath) continue;
    // JPEG/PNG/PDF are already compressed; store them as-is.
    zip.addFile(d.absolutePath, `${root}/${d.packFileName}`, { mtime: d.uploadedAt, compress: false });
  }
  const manifest = buildManifestCsv({
    applicationRef: input.applicationRef,
    generatedAt: input.generatedAt,
    includesApplicationPdf: pdfName,
    documents: input.documents,
  });
  zip.addBuffer(Buffer.from(manifest, "utf8"), `${root}/manifest.csv`, { mtime, compress: true });
  zip.end();
  const out = new PassThrough();
  zip.outputStream.on("error", (err) => out.destroy(err));
  return zip.outputStream.pipe(out);
}

/** pdf-lib standard fonts are WinAnsi only; replace anything else so drawing never throws. */
export function winAnsiSafe(text: string): string {
  return pdfSafeText(String(text || "")).replace(/\n/g, " ");
}

export type CombinedAttachmentOutcome = {
  label: string;
  originalFileName: string;
  merged: boolean;
  startPage: number | null;
  pageCount: number;
  reason: string | null;
};

const A4: [number, number] = [595.28, 841.89];

/**
 * Single printable PDF: application form, a contents page, then printable attachments.
 * PDF attachment pages are copied unaltered; images are embedded at original quality and
 * scaled down (never up) to fit A4. Anything not merged is listed and remains in the ZIP.
 */
export async function buildCombinedPrintablePdf(input: {
  applicationRef: string;
  schoolName: string;
  applicationPdf: Buffer;
  documents: PackDocument[];
  readFile?: (absolutePath: string) => Promise<Buffer>;
}): Promise<{ buffer: Buffer; outcomes: CombinedAttachmentOutcome[] }> {
  const readFile = input.readFile ?? ((p: string) => fs.readFile(p));
  const out = await PdfLibDocument.create();
  out.setTitle(winAnsiSafe(`Admission application ${input.applicationRef} — complete`));
  out.setAuthor(winAnsiSafe(input.schoolName));

  const appDoc = await PdfLibDocument.load(input.applicationPdf);
  const appPages = await out.copyPages(appDoc, appDoc.getPageIndices());
  appPages.forEach((p) => out.addPage(p));

  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const contentsIndex = out.getPageCount();
  const contentsPage = out.addPage(A4);

  const outcomes: CombinedAttachmentOutcome[] = [];
  let attachmentPages = 0;

  for (const d of input.documents) {
    const base = { label: d.label, originalFileName: d.originalFileName };
    if (!d.absolutePath) {
      outcomes.push({ ...base, merged: false, startPage: null, pageCount: 0, reason: "Stored file unavailable" });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(d.absolutePath);
    } catch {
      outcomes.push({ ...base, merged: false, startPage: null, pageCount: 0, reason: "Stored file unavailable" });
      continue;
    }
    const startPage = out.getPageCount() + 1;
    try {
      if (d.contentType === "application/pdf") {
        const src = await PdfLibDocument.load(bytes);
        const count = src.getPageCount();
        if (count === 0) {
          outcomes.push({ ...base, merged: false, startPage: null, pageCount: 0, reason: "PDF has no printable pages — download separately" });
          continue;
        }
        if (attachmentPages + count > COMBINED_PDF_MAX_ATTACHMENT_PAGES) {
          outcomes.push({ ...base, merged: false, startPage: null, pageCount: count, reason: "Too many pages — download separately" });
          continue;
        }
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        attachmentPages += count;
        outcomes.push({ ...base, merged: true, startPage, pageCount: count, reason: null });
      } else if (d.contentType === "image/jpeg" || d.contentType === "image/png") {
        if (attachmentPages + 1 > COMBINED_PDF_MAX_ATTACHMENT_PAGES) {
          outcomes.push({ ...base, merged: false, startPage: null, pageCount: 1, reason: "Too many pages — download separately" });
          continue;
        }
        const img = d.contentType === "image/jpeg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        const page = out.addPage(A4);
        const margin = 36;
        const captionH = 22;
        page.drawText(winAnsiSafe(`${input.applicationRef} · ${d.label} · ${d.originalFileName}`).slice(0, 110), {
          x: margin,
          y: A4[1] - margin - 10,
          size: 9,
          font: bold,
          color: rgb(0.07, 0.09, 0.15),
        });
        const maxW = A4[0] - margin * 2;
        const maxH = A4[1] - margin * 2 - captionH;
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, {
          x: margin + (maxW - w) / 2,
          y: margin + (maxH - h),
          width: w,
          height: h,
        });
        attachmentPages += 1;
        outcomes.push({ ...base, merged: true, startPage, pageCount: 1, reason: null });
      } else {
        outcomes.push({ ...base, merged: false, startPage: null, pageCount: 0, reason: "File type cannot be printed — included in ZIP" });
      }
    } catch (err) {
      const encrypted = /encrypt/i.test(String((err as Error)?.message || ""));
      outcomes.push({
        ...base,
        merged: false,
        startPage: null,
        pageCount: 0,
        reason: encrypted ? "Password-protected PDF — download separately" : "File could not be read for printing — download separately",
      });
    }
  }

  // Contents page
  const margin = 48;
  let y = A4[1] - margin;
  const draw = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
    const size = opts.size ?? 9;
    const f = opts.bold ? bold : font;
    const maxW = A4[0] - margin * 2;
    // Simple word wrap for WinAnsi text.
    const words = winAnsiSafe(text).split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    for (const l of lines) {
      if (y < margin + size) return;
      contentsPage.drawText(l, { x: margin, y, size, font: f, color: rgb(...(opts.color ?? [0.07, 0.09, 0.15])) });
      y -= size + 4;
    }
  };
  contentsPage.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: rgb(0.07, 0.09, 0.15) });
  contentsPage.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 2, color: rgb(0.83, 0.69, 0.22) });
  y -= 10;
  draw(`${input.schoolName} · Admission application ${input.applicationRef}`, { size: 9, bold: true, color: [0.42, 0.45, 0.5] });
  y -= 4;
  draw("ATTACHED SUPPORTING DOCUMENTS", { size: 14, bold: true });
  y -= 6;
  draw(`Pages 1–${contentsIndex}: application form.`, { size: 9 });
  y -= 6;
  if (!outcomes.length) {
    draw("No supporting documents were uploaded.", { size: 9 });
  }
  outcomes.forEach((o, i) => {
    const where = o.merged
      ? `page ${o.startPage}${o.pageCount > 1 ? `–${(o.startPage || 0) + o.pageCount - 1}` : ""}`
      : `NOT INCLUDED — ${o.reason}`;
    draw(`${i + 1}. ${o.label} (${o.originalFileName}): ${where}`, { size: 9, bold: !o.merged });
  });
  y -= 8;
  draw(
    "All original files, including any not printed here, are available in the complete application pack (ZIP).",
    { size: 8, color: [0.42, 0.45, 0.5] }
  );

  const buffer = Buffer.from(await out.save());
  return { buffer, outcomes };
}

export type AdmissionsDownloadEvent =
  | "DOCUMENT_VIEWED"
  | "DOCUMENT_DOWNLOADED"
  | "APPLICATION_PDF_GENERATED"
  | "APPLICATION_COMBINED_PDF_GENERATED"
  | "APPLICATION_DOCUMENTS_ZIP_DOWNLOADED"
  | "APPLICATION_PACK_DOWNLOADED";

/**
 * Download audit row. Metadata holds ids/counts only — no names, ID numbers or file paths.
 * Inserting an audit event never changes application or payment status.
 */
export async function recordAdmissionsDownloadAudit(
  prisma: PrismaClient,
  input: {
    schoolId: string;
    applicationId: string;
    actorUserId: string;
    eventType: AdmissionsDownloadEvent;
    metadata?: Record<string, string | number | boolean | null>;
  }
): Promise<void> {
  await prisma.admissionAuditEvent.create({
    data: {
      schoolId: input.schoolId,
      applicationId: input.applicationId,
      eventType: input.eventType,
      actorType: "STAFF",
      actorUserId: input.actorUserId,
      metadataJson: input.metadata ?? {},
    },
  });
}
