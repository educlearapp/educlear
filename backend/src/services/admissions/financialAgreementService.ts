/**
 * School-published financial policy / declaration versions and frozen applicant signatures.
 * Signature bytes are private admissions files, not AdmissionDocument rows and not payment proofs.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import type { Prisma, PrismaClient, SchoolAdmissionsLegalDocumentKind } from "@prisma/client";

import {
  buildAdmissionsStorageKey,
  resolveAdmissionsStorageRoot,
} from "./admissionsDocumentService";
import { detectAdmissionsMimeFromBuffer } from "./admissionsFileValidation";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";

export const FINANCIAL_SIGNATURE_MAX_BYTES = 150 * 1024;
export const FINANCIAL_DOCUMENT_KINDS = ["FINANCIAL_POLICY", "FINANCIAL_DECLARATION"] as const;

export type FinancialDocumentKind = (typeof FINANCIAL_DOCUMENT_KINDS)[number];

export type ActiveLegalDocument = {
  id: string;
  kind: FinancialDocumentKind;
  title: string;
  versionLabel: string;
  contentSha256: string;
  body: string;
  publishedAt: Date;
};

export type PublicFinancialDocument = {
  id: string;
  kind: FinancialDocumentKind;
  title: string;
  version: string;
  contentSha256: string;
  body: string;
};

type GuardianName = {
  id?: string;
  firstName: string;
  surname: string;
  idNumber?: string | null;
  isPayingPerson: boolean;
};

function normalizeIdentityNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function canonicalizeLegalBody(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function hashLegalBody(canonicalBody: string): string {
  return crypto.createHash("sha256").update(Buffer.from(canonicalBody, "utf8")).digest("hex");
}

/** Case-insensitive, whitespace-collapsed comparison. Apostrophes are kept. */
export function normalizeSignerName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
}

export function responsibleGuardianFullName(guardian: { firstName: string; surname: string }): string {
  return `${String(guardian.firstName || "").trim()} ${String(guardian.surname || "").trim()}`
    .replace(/\s+/g, " ")
    .trim();
}

export function payingGuardians<T extends { isPayingPerson: boolean }>(guardians: T[]): T[] {
  return guardians.filter((guardian) => guardian.isPayingPerson === true);
}

export function bothFinancialDocumentsPublished(
  documents: Array<{ kind: string }>
): boolean {
  const kinds = new Set(documents.map((document) => document.kind));
  return kinds.has("FINANCIAL_POLICY") && kinds.has("FINANCIAL_DECLARATION");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function assertKind(value: unknown): FinancialDocumentKind {
  const kind = clean(value);
  if (kind !== "FINANCIAL_POLICY" && kind !== "FINANCIAL_DECLARATION") {
    throw new PublicAdmissionsError("Unknown legal document kind", 400, "INVALID_LEGAL_DOCUMENT");
  }
  return kind;
}

export function toPublicFinancialDocument(document: ActiveLegalDocument): PublicFinancialDocument {
  return {
    id: document.id,
    kind: document.kind,
    title: document.title,
    version: document.versionLabel,
    contentSha256: document.contentSha256,
    body: document.body,
  };
}

export async function listActiveLegalDocuments(
  prisma: PrismaClient | Prisma.TransactionClient,
  schoolId: string
): Promise<ActiveLegalDocument[]> {
  const rows = await prisma.schoolAdmissionsLegalDocument.findMany({
    where: { schoolId, supersededAt: null },
    orderBy: { kind: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    versionLabel: row.versionLabel,
    contentSha256: row.contentSha256,
    body: row.body,
    publishedAt: row.publishedAt,
  }));
}

/**
 * Publish a new immutable version and supersede the previous active row.
 * Identical calls still create a new version; existing rows' bodies are never updated.
 */
export async function publishLegalDocument(
  prisma: PrismaClient,
  schoolId: string,
  input: { kind: unknown; versionLabel: unknown; title: unknown; body: unknown },
  now: Date = new Date()
): Promise<ActiveLegalDocument> {
  const sid = clean(schoolId);
  if (!sid) throw new PublicAdmissionsError("School context required", 403, "SCHOOL_REQUIRED");
  const kind = assertKind(input.kind);
  const versionLabel = clean(input.versionLabel);
  const title = clean(input.title);
  const body = canonicalizeLegalBody(input.body);
  if (!versionLabel || versionLabel.length > 40) {
    throw new PublicAdmissionsError("Version label is required", 400, "INVALID_LEGAL_DOCUMENT");
  }
  if (!title || title.length > 160) {
    throw new PublicAdmissionsError("Title is required", 400, "INVALID_LEGAL_DOCUMENT");
  }
  if (!body.trim() || body.length > 100_000) {
    throw new PublicAdmissionsError("Document text is required", 400, "INVALID_LEGAL_DOCUMENT");
  }
  const contentSha256 = hashLegalBody(body);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const active = await tx.schoolAdmissionsLegalDocument.findFirst({
        where: { schoolId: sid, kind, supersededAt: null },
      });
      if (active) {
        await tx.schoolAdmissionsLegalDocument.update({
          where: { id: active.id },
          data: { supersededAt: now },
        });
      }
      return tx.schoolAdmissionsLegalDocument.create({
        data: {
          schoolId: sid,
          kind,
          versionLabel,
          title,
          body,
          contentSha256,
          publishedAt: now,
        },
      });
    });
    return {
      id: created.id,
      kind: created.kind,
      title: created.title,
      versionLabel: created.versionLabel,
      contentSha256: created.contentSha256,
      body: created.body,
      publishedAt: created.publishedAt,
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw new PublicAdmissionsError(
        "Another financial document version is already active",
        409,
        "LEGAL_DOCUMENT_CONFLICT"
      );
    }
    throw err;
  }
}

type PngHeader = { width: number; height: number; bitDepth: number; colorType: number };

function readU32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** True when a PNG contains at least one non-white, non-transparent pixel. */
export function pngHasVisibleInk(buffer: Buffer): boolean {
  if (detectAdmissionsMimeFromBuffer(buffer) !== "image/png") return false;
  let offset = 8;
  let header: PngHeader | null = null;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = readU32(buffer, offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return false;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      header = {
        width: readU32(data, 0),
        height: readU32(data, 4),
        bitDepth: data[8],
        colorType: data[9],
      };
      if (data[12] !== 0) return false;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!header || !idat.length) return false;
  if (header.bitDepth !== 8) return false;
  if (![2, 6].includes(header.colorType)) return false;
  if (header.width < 1 || header.height < 1 || header.width > 2000 || header.height > 2000) {
    return false;
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return false;
  }
  if (raw.length < header.height * (stride + 1)) return false;
  const rows: Buffer[] = [];
  let cursor = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    const prev = rows[y - 1];
    if (filter === 1 || filter === 3 || filter === 4) {
      for (let i = 0; i < row.length; i += 1) {
        const left = i >= channels ? row[i - channels] : 0;
        const up = prev ? prev[i] : 0;
        const upLeft = prev && i >= channels ? prev[i - channels] : 0;
        if (filter === 1) row[i] = (row[i] + left) & 255;
        else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
        else row[i] = (row[i] + paeth(left, up, upLeft)) & 255;
      }
    } else if (filter === 2 && prev) {
      for (let i = 0; i < row.length; i += 1) row[i] = (row[i] + prev[i]) & 255;
    } else if (filter !== 0) {
      return false;
    }
    rows.push(row);
    for (let x = 0; x < header.width; x += 1) {
      const i = x * channels;
      const alpha = channels === 4 ? row[i + 3] : 255;
      if (alpha < 24) continue;
      if (row[i] < 248 || row[i + 1] < 248 || row[i + 2] < 248) return true;
    }
  }
  return false;
}

export function validateFinancialSignaturePng(buffer: Buffer, strokeCount: unknown): void {
  if (!buffer?.length) {
    throw new PublicAdmissionsError("Signature is required", 400, "SIGNATURE_REQUIRED");
  }
  if (buffer.length > FINANCIAL_SIGNATURE_MAX_BYTES) {
    throw new PublicAdmissionsError("Signature file is too large", 400, "FILE_TOO_LARGE");
  }
  if (detectAdmissionsMimeFromBuffer(buffer) !== "image/png") {
    throw new PublicAdmissionsError("Signature must be a PNG image", 400, "INVALID_SIGNATURE_TYPE");
  }
  const strokes = Number(strokeCount);
  if (!Number.isInteger(strokes) || strokes < 1) {
    throw new PublicAdmissionsError(
      "Draw your signature before signing",
      400,
      "SIGNATURE_STROKE_REQUIRED"
    );
  }
  if (!pngHasVisibleInk(buffer)) {
    throw new PublicAdmissionsError(
      "Draw your signature before signing",
      400,
      "SIGNATURE_BLANK"
    );
  }
}

export async function removePrivateSignatureFiles(keys: string[]): Promise<void> {
  const root = resolveAdmissionsStorageRoot();
  for (const key of keys) {
    if (!key || key.includes("..")) continue;
    const absolute = path.join(root, ...key.split("/"));
    if (!absolute.startsWith(root)) continue;
    await fs.unlink(absolute).catch(() => undefined);
  }
}

export async function deleteDraftFinancialAcceptances(
  tx: Prisma.TransactionClient,
  schoolId: string,
  applicationId: string
): Promise<string[]> {
  const rows = await tx.admissionFinancialAcceptance.findMany({
    where: { schoolId, applicationId },
    select: { id: true, signatureFileKey: true },
  });
  if (!rows.length) return [];
  await tx.admissionFinancialAcceptance.deleteMany({
    where: { schoolId, applicationId },
  });
  return rows.map((row) => row.signatureFileKey);
}

/**
 * Draft guardian replacement. Same paying-person name keeps the signature and retargets the new row id.
 * A name change, or zero/multiple paying guardians, deletes draft acceptances.
 */
export async function reconcileDraftFinancialSigner(
  tx: Prisma.TransactionClient,
  schoolId: string,
  applicationId: string,
  nextGuardians: GuardianName[]
): Promise<string[]> {
  const existing = await tx.admissionFinancialAcceptance.findMany({
    where: { schoolId, applicationId },
    select: { signerGuardianId: true, signerFullNameSnapshot: true },
  });
  if (!existing.length) return [];
  const prior = await tx.admissionGuardian.findFirst({
    where: { id: existing[0].signerGuardianId, schoolId, applicationId },
    select: { idNumber: true },
  });
  const payers = payingGuardians(nextGuardians);
  const expected = normalizeSignerName(existing[0].signerFullNameSnapshot);
  const nextName = payers.length === 1 ? normalizeSignerName(responsibleGuardianFullName(payers[0])) : "";
  const priorId = normalizeIdentityNumber(prior?.idNumber);
  const nextId = payers.length === 1 ? normalizeIdentityNumber(payers[0].idNumber) : "";
  if (payers.length !== 1 || !nextName || nextName !== expected || !prior || nextId !== priorId) {
    return deleteDraftFinancialAcceptances(tx, schoolId, applicationId);
  }
  return [];
}

export async function retargetDraftFinancialSigner(
  tx: Prisma.TransactionClient,
  schoolId: string,
  applicationId: string,
  guardianId: string
): Promise<void> {
  await tx.admissionFinancialAcceptance.updateMany({
    where: { schoolId, applicationId },
    data: { signerGuardianId: guardianId },
  });
}

export async function signFinancialAgreement(
  prisma: PrismaClient,
  input: {
    schoolId: string;
    applicationId: string;
    status: string;
    guardians: Array<{ id: string; firstName: string; surname: string; isPayingPerson: boolean }>;
    policyAccepted: unknown;
    declarationAccepted: unknown;
    typedSignerName: unknown;
    signaturePng: Buffer;
    strokeCount: unknown;
  },
  now: Date = new Date()
): Promise<void> {
  if (input.status !== "DRAFT") {
    throw new PublicAdmissionsError(
      "Financial agreement can only be signed on a draft application",
      409,
      "APPLICATION_NOT_EDITABLE"
    );
  }
  if (input.policyAccepted !== true && input.policyAccepted !== "true") {
    throw new PublicAdmissionsError(
      "Confirm that you have read and accept the financial policy",
      400,
      "FINANCIAL_POLICY_NOT_ACCEPTED"
    );
  }
  if (input.declarationAccepted !== true && input.declarationAccepted !== "true") {
    throw new PublicAdmissionsError(
      "Confirm that you have read and accept the financial declaration",
      400,
      "FINANCIAL_DECLARATION_NOT_ACCEPTED"
    );
  }
  validateFinancialSignaturePng(input.signaturePng, input.strokeCount);

  const payers = payingGuardians(input.guardians);
  if (payers.length !== 1) {
    throw new PublicAdmissionsError(
      "Exactly one guardian must be marked Responsible for fees",
      400,
      "PAYING_GUARDIAN_REQUIRED"
    );
  }
  const signer = payers[0];
  const signerName = responsibleGuardianFullName(signer);
  const typed = clean(input.typedSignerName);
  if (normalizeSignerName(typed) !== normalizeSignerName(signerName)) {
    throw new PublicAdmissionsError(
      "Typed name must match the guardian responsible for fees",
      400,
      "SIGNER_NAME_MISMATCH"
    );
  }

  const documents = await listActiveLegalDocuments(prisma, input.schoolId);
  if (!bothFinancialDocumentsPublished(documents)) {
    throw new PublicAdmissionsError(
      "Financial policy and declaration are not both published",
      409,
      "FINANCIAL_AGREEMENT_NOT_PUBLISHED"
    );
  }

  const signatureSha256 = crypto.createHash("sha256").update(input.signaturePng).digest("hex");
  const stored = buildAdmissionsStorageKey({
    schoolId: input.schoolId,
    applicationId: input.applicationId,
    storageExt: ".png",
  });
  await fs.mkdir(path.dirname(stored.absolutePath), { recursive: true });
  await fs.writeFile(stored.absolutePath, input.signaturePng);

  const removedKeys: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.admissionApplication.findFirst({
        where: { id: input.applicationId, schoolId: input.schoolId },
        select: { status: true },
      });
      if (!current || current.status !== "DRAFT") {
        throw new PublicAdmissionsError(
          "Financial agreement can only be signed on a draft application",
          409,
          "APPLICATION_NOT_EDITABLE"
        );
      }
      removedKeys.push(
        ...(await deleteDraftFinancialAcceptances(tx, input.schoolId, input.applicationId))
      );
      for (const document of documents) {
        await tx.admissionFinancialAcceptance.create({
          data: {
            schoolId: input.schoolId,
            applicationId: input.applicationId,
            kind: document.kind as SchoolAdmissionsLegalDocumentKind,
            documentId: document.id,
            titleSnapshot: document.title,
            bodySnapshot: document.body,
            contentSha256: document.contentSha256,
            signerGuardianId: signer.id,
            signerFullNameSnapshot: signerName,
            typedSignerName: typed,
            signatureFileKey: stored.storageKey,
            signatureContentType: "image/png",
            signatureSha256,
            acceptedAt: now,
            signedAt: now,
          },
        });
      }
      await tx.admissionAuditEvent.create({
        data: {
          schoolId: input.schoolId,
          applicationId: input.applicationId,
          eventType: "FINANCIAL_AGREEMENT_SIGNED",
          actorType: "APPLICANT",
          metadataJson: {
            documents: documents.map((document) => ({
              kind: document.kind,
              version: document.versionLabel,
              contentSha256: document.contentSha256,
            })),
          },
        },
      });
    });
  } catch (err) {
    await fs.unlink(stored.absolutePath).catch(() => undefined);
    throw err;
  }
  await removePrivateSignatureFiles(removedKeys.filter((key) => key !== stored.storageKey));
}

export type FinancialAcceptanceCheck = {
  kind: string;
  contentSha256: string;
  signerGuardianId: string;
  signerFullNameSnapshot: string;
  typedSignerName: string;
  signatureFileKey: string;
};

export function financialAgreementSubmitErrors(input: {
  documents: Array<{ kind: string; title: string; contentSha256: string }>;
  acceptances: FinancialAcceptanceCheck[];
  guardians: Array<{ id: string; firstName: string; surname: string; isPayingPerson: boolean }>;
}): Array<{ field: string; message: string }> {
  if (!bothFinancialDocumentsPublished(input.documents)) return [];
  const errors: Array<{ field: string; message: string }> = [];
  const payers = payingGuardians(input.guardians);
  if (payers.length !== 1) {
    errors.push({
      field: "guardians.isPayingPerson",
      message: "Exactly one guardian must be marked Responsible for fees",
    });
    return errors;
  }
  const signer = payers[0];
  const signerName = normalizeSignerName(responsibleGuardianFullName(signer));
  for (const document of input.documents) {
    const acceptance = input.acceptances.find((row) => row.kind === document.kind);
    if (!acceptance || acceptance.contentSha256 !== document.contentSha256) {
      errors.push({
        field: `financialAgreement.${document.kind}`,
        message: `${document.title} must be signed again`,
      });
      continue;
    }
    if (!acceptance.signatureFileKey) {
      errors.push({
        field: "financialAgreement.signature",
        message: "A drawn signature is required",
      });
    }
    if (
      acceptance.signerGuardianId !== signer.id ||
      normalizeSignerName(acceptance.signerFullNameSnapshot) !== signerName ||
      normalizeSignerName(acceptance.typedSignerName) !== signerName
    ) {
      errors.push({
        field: "financialAgreement.signer",
        message: "The financial agreement must be signed by the guardian responsible for fees",
      });
    }
  }
  return errors;
}

export async function openStaffFinancialSignature(
  prisma: PrismaClient,
  schoolId: string,
  applicationId: string
): Promise<{ absolutePath: string; contentType: string } | null> {
  const row = await prisma.admissionFinancialAcceptance.findFirst({
    where: { schoolId, applicationId, kind: "FINANCIAL_POLICY" },
    select: { signatureFileKey: true, signatureContentType: true },
  });
  if (!row?.signatureFileKey || row.signatureFileKey.includes("..")) return null;
  const root = path.resolve(resolveAdmissionsStorageRoot());
  const absolutePath = path.resolve(root, ...row.signatureFileKey.split("/"));
  if (!absolutePath.startsWith(root + path.sep)) return null;
  try {
    await fs.access(absolutePath);
  } catch {
    return null;
  }
  return { absolutePath, contentType: row.signatureContentType || "image/png" };
}
