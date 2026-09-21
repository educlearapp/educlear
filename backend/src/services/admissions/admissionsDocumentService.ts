/**
 * Private Admissions document storage + applicant document APIs (OA-03D).
 * Files live under data/admissions/{schoolId}/{applicationId}/ — never public /uploads.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import type { AdmissionApplicationStatus, Prisma, PrismaClient } from "@prisma/client";

import {
  ADMISSIONS_MAX_UPLOAD_BYTES,
  validateAdmissionsUploadBuffer,
} from "./admissionsFileValidation";
import { loadOwnedApplicationForApplicant } from "./draftApplicationService";
import {
  findRequiredDocumentConfig,
  parseRequiredDocumentConfig,
} from "./requiredDocumentConfig";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";

export const ADMISSIONS_STORAGE_PROVIDER = "local_disk";

/** Built-in document type keys; schools may also configure keys via requiredDocuments. */
export const BUILTIN_DOCUMENT_TYPES = [
  "birth_certificate",
  "learner_id",
  "parent_id",
  "guardian_id",
  "previous_school_report",
  "transfer_document",
  "proof_of_residence",
  "medical_document",
  "supporting_document",
  "proof_of_payment",
] as const;

const TERMINAL_APP_STATUSES = new Set<AdmissionApplicationStatus>([
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "CANCELLED",
]);

const SUPPORTING_DOC_EDITABLE = new Set<AdmissionApplicationStatus>([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFO_REQUESTED",
]);

const POP_UPLOADABLE = new Set<AdmissionApplicationStatus>([
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFO_REQUESTED",
]);

export type ApplicantDocumentView = {
  id: string;
  documentType: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
  scanStatus: string;
  isProofOfPayment: boolean;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function configuredDocumentKeys(settings: { requiredDocuments: unknown }): string[] {
  return parseRequiredDocumentConfig(settings.requiredDocuments).map((item) => item.key);
}

export function isAllowedDocumentType(
  documentType: string,
  settings: { requiredDocuments: unknown }
): boolean {
  const type = clean(documentType);
  if (!type || type.length > 80) return false;
  if ((BUILTIN_DOCUMENT_TYPES as readonly string[]).includes(type)) return true;
  return configuredDocumentKeys(settings).includes(type);
}

export function resolveAdmissionsStorageRoot(cwd: string = process.cwd()): string {
  return path.join(cwd, "data", "admissions");
}

export function buildAdmissionsStorageKey(input: {
  schoolId: string;
  applicationId: string;
  storageExt: string;
}): { storageKey: string; absolutePath: string } {
  const fileId = crypto.randomUUID();
  const relative = path.join(input.schoolId, input.applicationId, `${fileId}${input.storageExt}`);
  // Normalize to forward-slash logical key for DB portability
  const storageKey = relative.split(path.sep).join("/");
  const absolutePath = path.join(resolveAdmissionsStorageRoot(), ...storageKey.split("/"));
  return { storageKey, absolutePath };
}

function toView(doc: {
  id: string;
  documentType: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: Date;
  scanStatus: string;
}): ApplicantDocumentView {
  return {
    id: doc.id,
    documentType: doc.documentType,
    originalFileName: doc.originalFileName,
    contentType: doc.contentType,
    byteSize: doc.byteSize,
    uploadedAt: doc.uploadedAt.toISOString(),
    scanStatus: doc.scanStatus,
    isProofOfPayment: doc.documentType === "proof_of_payment",
  };
}

export async function listApplicantDocuments(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined
): Promise<{ documents: ApplicantDocumentView[]; requiredDocumentTypes: string[] }> {
  const { app, settings } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken
  );

  const docs = await prisma.admissionDocument.findMany({
    where: {
      applicationId: app.id,
      schoolId: app.schoolId,
      deletedAt: null,
    },
    orderBy: [{ documentType: "asc" }, { uploadedAt: "desc" }],
  });

  return {
    documents: docs.map(toView),
    requiredDocumentTypes: configuredDocumentKeys(settings),
  };
}

async function softReplaceActiveDocuments(
  tx: Prisma.TransactionClient,
  input: {
    schoolId: string;
    applicationId: string;
    documentType: string;
    newDocumentId: string;
  }
) {
  const active = await tx.admissionDocument.findMany({
    where: {
      schoolId: input.schoolId,
      applicationId: input.applicationId,
      documentType: input.documentType,
      deletedAt: null,
      id: { not: input.newDocumentId },
    },
  });
  for (const old of active) {
    await tx.admissionDocument.update({
      where: { id: old.id },
      data: {
        deletedAt: new Date(),
        replacedByDocumentId: input.newDocumentId,
      },
    });
  }
}

export async function uploadApplicantDocument(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  input: {
    documentType: string;
    buffer: Buffer;
    originalFileName: string;
    claimedMime?: string | null;
  }
): Promise<ApplicantDocumentView> {
  const documentType = clean(input.documentType);
  if (documentType === "proof_of_payment") {
    throw new PublicAdmissionsError(
      "Use the proof-of-payment endpoint for fee proofs",
      400,
      "USE_POP_ENDPOINT"
    );
  }

  const { app, schoolId, settings } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken
  );

  if (TERMINAL_APP_STATUSES.has(app.status)) {
    throw new PublicAdmissionsError(
      "Documents cannot be changed after a final decision",
      409,
      "APPLICATION_TERMINAL"
    );
  }
  if (!SUPPORTING_DOC_EDITABLE.has(app.status)) {
    throw new PublicAdmissionsError(
      "Documents cannot be uploaded in the current application state",
      409,
      "DOCUMENT_UPLOAD_NOT_ALLOWED"
    );
  }
  if (!isAllowedDocumentType(documentType, settings)) {
    throw new PublicAdmissionsError("Unknown document type", 400, "INVALID_DOCUMENT_TYPE");
  }
  const documentConfig = findRequiredDocumentConfig(settings.requiredDocuments, documentType);

  let validated;
  try {
    validated = validateAdmissionsUploadBuffer({
      buffer: input.buffer,
      originalFileName: input.originalFileName,
      claimedMime: input.claimedMime,
    });
  } catch (err: any) {
    const code = String(err?.code || "INVALID_FILE");
    throw new PublicAdmissionsError(err?.message || "Invalid file", 400, code);
  }

  const checksumSha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const { storageKey, absolutePath } = buildAdmissionsStorageKey({
    schoolId,
    applicationId: app.id,
    storageExt: validated.storageExt,
  });

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, input.buffer, { flag: "wx" });

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (documentConfig?.allowMultiple) {
        const activeCount = await tx.admissionDocument.count({
          where: {
            schoolId,
            applicationId: app.id,
            documentType,
            deletedAt: null,
          },
        });
        if (activeCount >= documentConfig.maxCount) {
          throw new PublicAdmissionsError(
            `A maximum of ${documentConfig.maxCount} files may be uploaded for this document`,
            409,
            "DOCUMENT_LIMIT_REACHED"
          );
        }
      }
      const doc = await tx.admissionDocument.create({
        data: {
          schoolId,
          applicationId: app.id,
          documentType,
          originalFileName: validated.originalFileName,
          contentType: validated.contentType,
          byteSize: input.buffer.length,
          storageProvider: ADMISSIONS_STORAGE_PROVIDER,
          storageKey,
          checksumSha256,
          uploadedBy: "APPLICANT",
          scanStatus: "NOT_SCANNED",
        },
      });
      if (!documentConfig?.allowMultiple) {
        await softReplaceActiveDocuments(tx, {
          schoolId,
          applicationId: app.id,
          documentType,
          newDocumentId: doc.id,
        });
      }
      await tx.admissionAuditEvent.create({
        data: {
          schoolId,
          applicationId: app.id,
          eventType: "DOCUMENT_UPLOADED",
          actorType: "APPLICANT",
          metadataJson: {
            documentId: doc.id,
            documentType,
            contentType: validated.contentType,
            byteSize: input.buffer.length,
          },
        },
      });
      await tx.admissionApplication.update({
        where: { id: app.id },
        data: { lastApplicantActivityAt: new Date() },
      });
      return doc;
    });
    return toView(created);
  } catch (err) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw err;
  }
}

export async function uploadProofOfPayment(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  input: {
    buffer: Buffer;
    originalFileName: string;
    claimedMime?: string | null;
  }
): Promise<{ document: ApplicantDocumentView; paymentStatus: string }> {
  const { app, schoolId } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken
  );

  if (TERMINAL_APP_STATUSES.has(app.status)) {
    throw new PublicAdmissionsError(
      "Proof of payment cannot be changed after a final decision",
      409,
      "APPLICATION_TERMINAL"
    );
  }
  if (!POP_UPLOADABLE.has(app.status)) {
    throw new PublicAdmissionsError(
      "Proof of payment can only be uploaded after formal submission",
      409,
      "POP_REQUIRES_SUBMISSION"
    );
  }

  const fee = await prisma.admissionFeeRecord.findUnique({
    where: { applicationId: app.id },
  });
  if (!fee || !fee.required) {
    throw new PublicAdmissionsError(
      "No admission fee requires proof of payment for this application",
      400,
      "FEE_NOT_REQUIRED"
    );
  }
  if (fee.paymentStatus === "VERIFIED" || fee.paymentStatus === "WAIVED") {
    throw new PublicAdmissionsError(
      "Proof of payment cannot be changed for this payment state",
      409,
      "PAYMENT_LOCKED"
    );
  }

  let validated;
  try {
    validated = validateAdmissionsUploadBuffer({
      buffer: input.buffer,
      originalFileName: input.originalFileName,
      claimedMime: input.claimedMime,
    });
  } catch (err: any) {
    throw new PublicAdmissionsError(err?.message || "Invalid file", 400, String(err?.code || "INVALID_FILE"));
  }

  const checksumSha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const { storageKey, absolutePath } = buildAdmissionsStorageKey({
    schoolId,
    applicationId: app.id,
    storageExt: validated.storageExt,
  });

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, input.buffer, { flag: "wx" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.admissionDocument.create({
        data: {
          schoolId,
          applicationId: app.id,
          documentType: "proof_of_payment",
          originalFileName: validated.originalFileName,
          contentType: validated.contentType,
          byteSize: input.buffer.length,
          storageProvider: ADMISSIONS_STORAGE_PROVIDER,
          storageKey,
          checksumSha256,
          uploadedBy: "APPLICANT",
          scanStatus: "NOT_SCANNED",
        },
      });
      await softReplaceActiveDocuments(tx, {
        schoolId,
        applicationId: app.id,
        documentType: "proof_of_payment",
        newDocumentId: doc.id,
      });

      const fromStatus = fee.paymentStatus;
      const toStatus = "PROOF_UPLOADED" as const;
      await tx.admissionFeeRecord.update({
        where: { applicationId: app.id },
        data: {
          latestProofDocumentId: doc.id,
          paymentStatus: toStatus,
          // Never set verified*/waived*/rejected* from applicant path
        },
      });
      await tx.admissionPaymentHistory.create({
        data: {
          schoolId,
          applicationId: app.id,
          fromStatus,
          toStatus,
          actorType: "APPLICANT",
          reason: "Proof of payment uploaded",
        },
      });
      await tx.admissionAuditEvent.create({
        data: {
          schoolId,
          applicationId: app.id,
          eventType: "PROOF_OF_PAYMENT_UPLOADED",
          actorType: "APPLICANT",
          metadataJson: {
            documentId: doc.id,
            contentType: validated.contentType,
            byteSize: input.buffer.length,
            paymentStatus: toStatus,
          },
        },
      });
      await tx.admissionApplication.update({
        where: { id: app.id },
        data: { lastApplicantActivityAt: new Date() },
      });
      return { doc, paymentStatus: toStatus };
    });

    return { document: toView(result.doc), paymentStatus: result.paymentStatus };
  } catch (err) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw err;
  }
}

export async function deleteApplicantDocument(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  documentId: string
): Promise<void> {
  const { app, schoolId } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken
  );

  if (TERMINAL_APP_STATUSES.has(app.status)) {
    throw new PublicAdmissionsError(
      "Documents cannot be changed after a final decision",
      409,
      "APPLICATION_TERMINAL"
    );
  }

  const doc = await prisma.admissionDocument.findFirst({
    where: {
      id: clean(documentId),
      applicationId: app.id,
      schoolId,
      deletedAt: null,
      uploadedBy: "APPLICANT",
    },
  });
  if (!doc) {
    throw new PublicAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  if (doc.documentType === "proof_of_payment") {
    if (!POP_UPLOADABLE.has(app.status)) {
      throw new PublicAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    }
    const fee = await prisma.admissionFeeRecord.findUnique({ where: { applicationId: app.id } });
    if (fee && (fee.paymentStatus === "VERIFIED" || fee.paymentStatus === "WAIVED")) {
      throw new PublicAdmissionsError(
        "Proof of payment cannot be changed for this payment state",
        409,
        "PAYMENT_LOCKED"
      );
    }
  } else if (!SUPPORTING_DOC_EDITABLE.has(app.status)) {
    throw new PublicAdmissionsError(
      "Documents cannot be removed in the current application state",
      409,
      "DOCUMENT_DELETE_NOT_ALLOWED"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.admissionDocument.update({
      where: { id: doc.id },
      data: { deletedAt: new Date() },
    });

    if (doc.documentType === "proof_of_payment") {
      const fee = await tx.admissionFeeRecord.findUnique({ where: { applicationId: app.id } });
      if (fee && fee.latestProofDocumentId === doc.id) {
        const remaining = await tx.admissionDocument.findFirst({
          where: {
            applicationId: app.id,
            schoolId,
            documentType: "proof_of_payment",
            deletedAt: null,
            id: { not: doc.id },
          },
          orderBy: { uploadedAt: "desc" },
        });
        const nextStatus = remaining ? "PROOF_UPLOADED" : "AWAITING_PAYMENT";
        await tx.admissionFeeRecord.update({
          where: { applicationId: app.id },
          data: {
            latestProofDocumentId: remaining?.id ?? null,
            paymentStatus: nextStatus,
          },
        });
        await tx.admissionPaymentHistory.create({
          data: {
            schoolId,
            applicationId: app.id,
            fromStatus: fee.paymentStatus,
            toStatus: nextStatus,
            actorType: "APPLICANT",
            reason: "Proof of payment removed",
          },
        });
      }
    }

    await tx.admissionAuditEvent.create({
      data: {
        schoolId,
        applicationId: app.id,
        eventType: "DOCUMENT_DELETED",
        actorType: "APPLICANT",
        metadataJson: { documentId: doc.id, documentType: doc.documentType },
      },
    });
  });
}

export async function openApplicantDocumentForDownload(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  documentId: string
): Promise<{ absolutePath: string; contentType: string; originalFileName: string }> {
  const { app, schoolId } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken
  );

  const doc = await prisma.admissionDocument.findFirst({
    where: {
      id: clean(documentId),
      applicationId: app.id,
      schoolId,
      deletedAt: null,
    },
  });
  if (!doc) {
    throw new PublicAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const file = resolveLocalAdmissionsDocumentFile(doc);
  await fs.access(file.absolutePath);
  return file;
}

/**
 * Resolve private on-disk path from trusted DB metadata (OA-03D storage).
 * Never accepts client-supplied paths/keys.
 */
export function resolveLocalAdmissionsDocumentFile(doc: {
  storageProvider: string;
  storageKey: string;
  contentType: string;
  originalFileName: string;
}): { absolutePath: string; contentType: string; originalFileName: string } {
  if (doc.storageProvider !== ADMISSIONS_STORAGE_PROVIDER) {
    throw new PublicAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const root = resolveAdmissionsStorageRoot();
  const absolutePath = path.join(root, ...doc.storageKey.split("/"));
  const resolved = path.resolve(absolutePath);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw new PublicAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  return {
    absolutePath: resolved,
    contentType: doc.contentType,
    originalFileName: doc.originalFileName,
  };
}

export { ADMISSIONS_MAX_UPLOAD_BYTES };
