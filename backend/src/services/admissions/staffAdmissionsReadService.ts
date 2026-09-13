/**
 * Staff Admissions inbox + application detail (OA-03F) — read-only.
 * Tenant = authorizedSchoolId from JWT→DB. Never trust client schoolId.
 */
import type {
  AdmissionApplicationStatus,
  AdmissionPaymentStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import fs from "fs/promises";

import {
  resolveLocalAdmissionsDocumentFile,
} from "./admissionsDocumentService";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";

export class StaffAdmissionsError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Array<{ field: string; message: string }>;
  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = "StaffAdmissionsError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dec(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(2);
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Required document type keys from school settings (required !== false when key present). */
export function parseRequiredDocumentTypes(requiredDocuments: unknown): string[] {
  if (!Array.isArray(requiredDocuments)) return [];
  const keys: string[] = [];
  for (const item of requiredDocuments) {
    if (!item || typeof item !== "object") continue;
    const row = item as { key?: unknown; required?: unknown };
    const key = clean(row.key);
    if (!key || key === "proof_of_payment") continue;
    // Only explicitly required documents count toward completeness
    if (row.required !== true) continue;
    keys.push(key);
  }
  return keys;
}

export type DocumentCompleteness = {
  requiredDocumentTypes: string[];
  uploadedDocumentTypes: string[];
  missingDocumentTypes: string[];
  documentsComplete: boolean;
};

export function deriveDocumentCompleteness(input: {
  requiredDocumentTypes: string[];
  activeDocumentTypes: string[];
}): DocumentCompleteness {
  const uploaded = Array.from(
    new Set(input.activeDocumentTypes.map((t) => clean(t)).filter(Boolean))
  ).sort();
  const required = Array.from(
    new Set(input.requiredDocumentTypes.map((t) => clean(t)).filter(Boolean))
  );
  const missing = required.filter((t) => !uploaded.includes(t));
  return {
    requiredDocumentTypes: required,
    uploadedDocumentTypes: uploaded,
    missingDocumentTypes: missing,
    documentsComplete: missing.length === 0,
  };
}

export type StaffDocumentMeta = {
  id: string;
  documentType: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
  scanStatus: string;
  uploadedBy: string;
  isProofOfPayment: boolean;
};

function toStaffDocumentMeta(doc: {
  id: string;
  documentType: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: Date;
  scanStatus: string;
  uploadedBy: string;
}): StaffDocumentMeta {
  return {
    id: doc.id,
    documentType: doc.documentType,
    originalFileName: doc.originalFileName,
    contentType: doc.contentType,
    byteSize: doc.byteSize,
    uploadedAt: doc.uploadedAt.toISOString(),
    scanStatus: doc.scanStatus,
    uploadedBy: doc.uploadedBy,
    isProofOfPayment: doc.documentType === "proof_of_payment",
  };
}

export type PromotedLearnerSummary = {
  id: string;
  firstName: string;
  lastName: string;
  admissionNo: string | null;
  grade: string;
};

export type StaffApplicationListItem = {
  id: string;
  applicationNumber: string | null;
  status: string;
  submittedAt: string | null;
  updatedAt: string;
  createdAt: string;
  intakeYear: number;
  requestedGrade: string | null;
  learnerFirstName: string | null;
  learnerLastName: string | null;
  primaryGuardianName: string | null;
  primaryGuardianCellNo: string | null;
  primaryGuardianEmail: string | null;
  paymentStatus: string | null;
  feeRequired: boolean;
  feeAmount: string | null;
  feeCurrency: string | null;
  proofUploaded: boolean;
  documentsComplete: boolean;
  missingDocumentCount: number;
  promotedLearnerId: string | null;
  promotedFamilyAccountId: string | null;
};

export type ListStaffApplicationsQuery = {
  status?: string | null;
  paymentStatus?: string | null;
  requestedGrade?: string | null;
  intakeYear?: number | null;
  q?: string | null;
  submittedFrom?: string | null;
  submittedTo?: string | null;
  includeDrafts?: boolean;
  page?: number;
  pageSize?: number;
};

export type ListStaffApplicationsResult = {
  items: StaffApplicationListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const APP_STATUSES = new Set<string>([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFO_REQUESTED",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "CANCELLED",
]);

const PAY_STATUSES = new Set<string>([
  "NOT_REQUIRED",
  "AWAITING_PAYMENT",
  "PROOF_UPLOADED",
  "UNDER_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "WAIVED",
]);

function parsePage(page: unknown): number {
  const n = Number(page);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function parsePageSize(pageSize: unknown): number {
  const n = Number(pageSize);
  if (!Number.isFinite(n)) return 20;
  return Math.min(100, Math.max(5, Math.floor(n)));
}

function parseOptionalDate(raw: string | null | undefined, endOfDay: boolean): Date | null {
  const s = clean(raw);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new StaffAdmissionsError("Invalid date filter", 400, "INVALID_DATE");
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
}

export function buildStaffApplicationsWhere(
  schoolId: string,
  query: ListStaffApplicationsQuery
): Prisma.AdmissionApplicationWhereInput {
  const where: Prisma.AdmissionApplicationWhereInput = { schoolId };

  const statusRaw = clean(query.status);
  if (statusRaw) {
    const statuses = statusRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => APP_STATUSES.has(s));
    if (!statuses.length) {
      throw new StaffAdmissionsError("Invalid application status filter", 400, "INVALID_STATUS");
    }
    where.status = { in: statuses as AdmissionApplicationStatus[] };
  } else if (!query.includeDrafts) {
    where.status = { not: "DRAFT" };
  }

  const payRaw = clean(query.paymentStatus);
  if (payRaw) {
    const pays = payRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => PAY_STATUSES.has(s));
    if (!pays.length) {
      throw new StaffAdmissionsError("Invalid payment status filter", 400, "INVALID_PAYMENT_STATUS");
    }
    where.feeRecord = {
      is: { paymentStatus: { in: pays as AdmissionPaymentStatus[] } },
    };
  }

  const grade = clean(query.requestedGrade);
  if (grade) where.requestedGrade = grade;

  if (query.intakeYear != null && Number.isFinite(Number(query.intakeYear))) {
    where.intakeYear = Math.floor(Number(query.intakeYear));
  }

  const from = parseOptionalDate(query.submittedFrom, false);
  const to = parseOptionalDate(query.submittedTo, true);
  if (from || to) {
    where.submittedAt = {};
    if (from) where.submittedAt.gte = from;
    if (to) where.submittedAt.lte = to;
  }

  const q = clean(query.q);
  if (q) {
    where.OR = [
      { applicationNumber: { contains: q, mode: "insensitive" } },
      {
        learnerCandidate: {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
          ],
        },
      },
      {
        guardians: {
          some: {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { surname: { contains: q, mode: "insensitive" } },
              { cellNo: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  return where;
}

function primaryGuardianSummary(
  guardians: Array<{
    firstName: string;
    surname: string;
    cellNo: string | null;
    email: string | null;
    isPrimary: boolean;
    sortOrder: number;
  }>
) {
  const sorted = [...guardians].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
  const g = sorted[0];
  if (!g) {
    return { name: null as string | null, cellNo: null as string | null, email: null as string | null };
  }
  return {
    name: `${g.firstName} ${g.surname}`.trim(),
    cellNo: g.cellNo,
    email: g.email,
  };
}

/**
 * Paginated staff inbox. Read-only. schoolId must be authorizedSchoolId.
 */
export async function listStaffApplications(
  prisma: PrismaClient,
  schoolId: string,
  query: ListStaffApplicationsQuery = {}
): Promise<ListStaffApplicationsResult> {
  const sid = clean(schoolId);
  if (!sid) {
    throw new StaffAdmissionsError("School context required", 403, "SCHOOL_REQUIRED");
  }

  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const where = buildStaffApplicationsWhere(sid, query);

  const settings = await prisma.schoolAdmissionsSettings.findUnique({
    where: { schoolId: sid },
    select: { requiredDocuments: true },
  });
  const requiredTypes = parseRequiredDocumentTypes(settings?.requiredDocuments ?? []);

  const [total, rows] = await Promise.all([
    prisma.admissionApplication.count({ where }),
    prisma.admissionApplication.findMany({
      where,
      orderBy: [
        { submittedAt: "desc" },
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        applicationNumber: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        createdAt: true,
        intakeYear: true,
        requestedGrade: true,
        promotedLearnerId: true,
        promotedFamilyAccountId: true,
        feeRequired: true,
        feeAmount: true,
        feeCurrency: true,
        learnerCandidate: { select: { firstName: true, lastName: true } },
        guardians: {
          select: {
            firstName: true,
            surname: true,
            cellNo: true,
            email: true,
            isPrimary: true,
            sortOrder: true,
          },
        },
        feeRecord: {
          select: {
            required: true,
            amount: true,
            currency: true,
            paymentStatus: true,
            latestProofDocumentId: true,
          },
        },
        documents: {
          where: { deletedAt: null },
          select: { documentType: true },
        },
      },
    }),
  ]);

  const items: StaffApplicationListItem[] = rows.map((row) => {
    const completeness = deriveDocumentCompleteness({
      requiredDocumentTypes: requiredTypes,
      activeDocumentTypes: row.documents.map((d) => d.documentType),
    });
    const guardian = primaryGuardianSummary(row.guardians);
    const feeRequired = Boolean(row.feeRecord?.required ?? row.feeRequired);
    const paymentStatus = row.feeRecord?.paymentStatus ?? (feeRequired ? null : "NOT_REQUIRED");
    const proofUploaded = Boolean(
      row.feeRecord?.latestProofDocumentId ||
        ["PROOF_UPLOADED", "UNDER_VERIFICATION", "VERIFIED"].includes(String(paymentStatus))
    );

    return {
      id: row.id,
      applicationNumber: row.applicationNumber,
      status: row.status,
      submittedAt: iso(row.submittedAt),
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      intakeYear: row.intakeYear,
      requestedGrade: row.requestedGrade,
      learnerFirstName: row.learnerCandidate?.firstName ?? null,
      learnerLastName: row.learnerCandidate?.lastName ?? null,
      primaryGuardianName: guardian.name,
      primaryGuardianCellNo: guardian.cellNo,
      primaryGuardianEmail: guardian.email,
      paymentStatus,
      feeRequired,
      feeAmount: dec(row.feeRecord?.amount ?? row.feeAmount),
      feeCurrency: row.feeRecord?.currency ?? row.feeCurrency,
      proofUploaded,
      documentsComplete: completeness.documentsComplete,
      missingDocumentCount: completeness.missingDocumentTypes.length,
      promotedLearnerId: row.promotedLearnerId,
      promotedFamilyAccountId: row.promotedFamilyAccountId,
    };
  });

  return { items, total, page, pageSize };
}

export type StaffApplicationDetail = {
  id: string;
  publicAccessId: string;
  applicationNumber: string | null;
  status: string;
  intakeYear: number;
  requestedGrade: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastApplicantActivityAt: string | null;
  feeRequired: boolean;
  feeAmount: string | null;
  feeCurrency: string | null;
  feeSnapshotAt: string | null;
  declaredExistingSibling: boolean;
  declaredSiblingLearnerName: string | null;
  declaredSiblingAdmissionNo: string | null;
  declaredExistingFamily: boolean;
  privacyAcceptedAt: string | null;
  declarationsAcceptedAt: string | null;
  privacyNoticeVersion: string | null;
  statusReason: string | null;
  promotedLearnerId: string | null;
  promotedFamilyAccountId: string | null;
  promotedLearner: PromotedLearnerSummary | null;
  learner: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    birthDate: string | null;
    gender: string | null;
    idNumber: string | null;
    homeLanguage: string | null;
    citizenship: string | null;
    homeAddress: string | null;
    allergies: string | null;
    medicalAlert: string | null;
    previousSchoolName: string | null;
    notes: string | null;
  } | null;
  guardians: Array<{
    id: string;
    title: string | null;
    firstName: string;
    surname: string;
    relationship: string | null;
    idNumber: string | null;
    cellNo: string | null;
    email: string | null;
    homeAddress: string | null;
    employer: string | null;
    isPrimary: boolean;
    isPayingPerson: boolean;
    sortOrder: number;
  }>;
  answers: Array<{
    questionKey: string;
    questionLabelSnapshot: string;
    valueJson: unknown;
  }>;
  documents: StaffDocumentMeta[];
  documentCompleteness: DocumentCompleteness;
  payment: {
    required: boolean;
    amount: string | null;
    currency: string;
    paymentStatus: string;
    paymentReference: string | null;
    proofUploaded: boolean;
    proofDocument: StaffDocumentMeta | null;
    verifiedAt: string | null;
    verifiedByUserId: string | null;
    waivedAt: string | null;
    waivedByUserId: string | null;
    rejectedAt: string | null;
    // Staff-only context; applicant APIs never see this
    rejectionReason: string | null;
    waiveReason: string | null;
  } | null;
  paymentHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    actorUserId: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    actorUserId: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  auditTimeline: Array<{
    id: string;
    eventType: string;
    actorType: string;
    actorUserId: string | null;
    metadataJson: unknown;
    createdAt: string;
  }>;
  staffNotes: Array<{
    id: string;
    authorUserId: string;
    body: string;
    createdAt: string;
    updatedAt: string;
  }> | null;
};

/**
 * Single application detail for staff review. Read-only.
 *
 * includeMedicalDetails / includeStaffNotes are capability flags from the route after
 * permission checks. Client query params must never grant these.
 */
export async function getStaffApplicationDetail(
  prisma: PrismaClient,
  schoolId: string,
  applicationId: string,
  options: {
    includeStaffNotes?: boolean;
    includeMedicalDetails?: boolean;
  } = {}
): Promise<StaffApplicationDetail> {
  const sid = clean(schoolId);
  const appId = clean(applicationId);
  if (!sid) {
    throw new StaffAdmissionsError("School context required", 403, "SCHOOL_REQUIRED");
  }
  if (!appId) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const includeStaffNotes = Boolean(options.includeStaffNotes);
  const includeMedicalDetails = Boolean(options.includeMedicalDetails);

  const settings = await prisma.schoolAdmissionsSettings.findUnique({
    where: { schoolId: sid },
    select: { requiredDocuments: true },
  });
  const requiredTypes = parseRequiredDocumentTypes(settings?.requiredDocuments ?? []);

  const app = await prisma.admissionApplication.findFirst({
    where: { id: appId, schoolId: sid },
    include: {
      promotedLearner: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNo: true,
          grade: true,
        },
      },
      learnerCandidate: true,
      guardians: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
      answers: { orderBy: { createdAt: "asc" } },
      documents: {
        where: { deletedAt: null },
        orderBy: [{ documentType: "asc" }, { uploadedAt: "desc" }],
      },
      feeRecord: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      paymentHistory: { orderBy: { createdAt: "asc" } },
      auditEvents: { orderBy: { createdAt: "asc" } },
      staffNotes: includeStaffNotes ? { orderBy: { createdAt: "asc" } } : false,
    },
  });

  if (!app) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const docs = app.documents.map(toStaffDocumentMeta);
  const completeness = deriveDocumentCompleteness({
    requiredDocumentTypes: requiredTypes,
    activeDocumentTypes: docs.map((d) => d.documentType),
  });

  let proofDocument: StaffDocumentMeta | null = null;
  if (app.feeRecord?.latestProofDocumentId) {
    proofDocument = docs.find((d) => d.id === app.feeRecord!.latestProofDocumentId) || null;
  }

  const paymentStatus =
    app.feeRecord?.paymentStatus ?? (app.feeRequired ? "AWAITING_PAYMENT" : "NOT_REQUIRED");

  const lc = app.learnerCandidate;

  return {
    id: app.id,
    publicAccessId: app.publicAccessId,
    applicationNumber: app.applicationNumber,
    status: app.status,
    intakeYear: app.intakeYear,
    requestedGrade: app.requestedGrade,
    submittedAt: iso(app.submittedAt),
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    lastApplicantActivityAt: iso(app.lastApplicantActivityAt),
    feeRequired: Boolean(app.feeRequired),
    feeAmount: dec(app.feeAmount),
    feeCurrency: app.feeCurrency,
    feeSnapshotAt: iso(app.feeSnapshotAt),
    declaredExistingSibling: app.declaredExistingSibling,
    declaredSiblingLearnerName: app.declaredSiblingLearnerName,
    declaredSiblingAdmissionNo: app.declaredSiblingAdmissionNo,
    declaredExistingFamily: app.declaredExistingFamily,
    privacyAcceptedAt: iso(app.privacyAcceptedAt),
    declarationsAcceptedAt: iso(app.declarationsAcceptedAt),
    privacyNoticeVersion: app.privacyNoticeVersion,
    statusReason: app.statusReason,
    promotedLearnerId: app.promotedLearnerId,
    promotedFamilyAccountId: app.promotedFamilyAccountId,
    promotedLearner: app.promotedLearner
      ? {
          id: app.promotedLearner.id,
          firstName: app.promotedLearner.firstName,
          lastName: app.promotedLearner.lastName,
          admissionNo: app.promotedLearner.admissionNo,
          grade: app.promotedLearner.grade,
        }
      : null,
    learner: lc
      ? {
          firstName: lc.firstName,
          lastName: lc.lastName,
          nickname: lc.nickname,
          birthDate: iso(lc.birthDate),
          gender: lc.gender,
          idNumber: lc.idNumber,
          homeLanguage: lc.homeLanguage,
          citizenship: lc.citizenship,
          homeAddress: lc.homeAddress,
          allergies: includeMedicalDetails ? lc.allergies : null,
          medicalAlert: includeMedicalDetails ? lc.medicalAlert : null,
          previousSchoolName: lc.previousSchoolName,
          notes: includeMedicalDetails ? lc.notes : null,
        }
      : null,
    guardians: app.guardians.map((g) => ({
      id: g.id,
      title: g.title,
      firstName: g.firstName,
      surname: g.surname,
      relationship: g.relationship,
      idNumber: g.idNumber,
      cellNo: g.cellNo,
      email: g.email,
      homeAddress: g.homeAddress,
      employer: g.employer,
      isPrimary: g.isPrimary,
      isPayingPerson: g.isPayingPerson,
      sortOrder: g.sortOrder,
    })),
    answers: app.answers.map((a) => ({
      questionKey: a.questionKey,
      questionLabelSnapshot: a.questionLabelSnapshot,
      valueJson: a.valueJson,
    })),
    documents: docs,
    documentCompleteness: completeness,
    payment: app.feeRecord
      ? {
          required: app.feeRecord.required,
          amount: dec(app.feeRecord.amount),
          currency: app.feeRecord.currency,
          paymentStatus: app.feeRecord.paymentStatus,
          paymentReference: app.feeRecord.paymentReference,
          proofUploaded: Boolean(proofDocument) ||
            ["PROOF_UPLOADED", "UNDER_VERIFICATION", "VERIFIED"].includes(app.feeRecord.paymentStatus),
          proofDocument,
          verifiedAt: iso(app.feeRecord.verifiedAt),
          verifiedByUserId: app.feeRecord.verifiedByUserId,
          waivedAt: iso(app.feeRecord.waivedAt),
          waivedByUserId: app.feeRecord.waivedByUserId,
          rejectedAt: iso(app.feeRecord.rejectedAt),
          rejectionReason: app.feeRecord.rejectionReason,
          waiveReason: app.feeRecord.waiveReason,
        }
      : {
          required: app.feeRequired,
          amount: dec(app.feeAmount),
          currency: app.feeCurrency || "ZAR",
          paymentStatus,
          paymentReference: app.applicationNumber,
          proofUploaded: false,
          proofDocument: null,
          verifiedAt: null,
          verifiedByUserId: null,
          waivedAt: null,
          waivedByUserId: null,
          rejectedAt: null,
          rejectionReason: null,
          waiveReason: null,
        },
    paymentHistory: app.paymentHistory.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      actorType: h.actorType,
      actorUserId: h.actorUserId,
      reason: h.reason,
      createdAt: h.createdAt.toISOString(),
    })),
    statusHistory: app.statusHistory.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      actorType: h.actorType,
      actorUserId: h.actorUserId,
      reason: h.reason,
      createdAt: h.createdAt.toISOString(),
    })),
    auditTimeline: app.auditEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      actorType: e.actorType,
      actorUserId: e.actorUserId,
      metadataJson: e.metadataJson,
      createdAt: e.createdAt.toISOString(),
    })),
    staffNotes: includeStaffNotes
      ? (("staffNotes" in app && Array.isArray(app.staffNotes) ? app.staffNotes : []) as Array<{
          id: string;
          authorUserId: string;
          body: string;
          createdAt: Date;
          updatedAt: Date;
        }>).map((n) => ({
          id: n.id,
          authorUserId: n.authorUserId,
          body: n.body,
          createdAt: n.createdAt.toISOString(),
          updatedAt: n.updatedAt.toISOString(),
        }))
      : null,
  };
}

/**
 * Staff download of an active (non-deleted) Admissions document for an owned application.
 * Path resolved only from DB storageKey under private admissions root.
 */
export async function openStaffApplicationDocumentForDownload(
  prisma: PrismaClient,
  schoolId: string,
  applicationId: string,
  documentId: string
): Promise<{ absolutePath: string; contentType: string; originalFileName: string }> {
  const sid = clean(schoolId);
  const appId = clean(applicationId);
  const docId = clean(documentId);
  if (!sid) {
    throw new StaffAdmissionsError("School context required", 403, "SCHOOL_REQUIRED");
  }
  if (!appId || !docId) {
    throw new StaffAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const app = await prisma.admissionApplication.findFirst({
    where: { id: appId, schoolId: sid },
    select: { id: true },
  });
  if (!app) {
    throw new StaffAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const doc = await prisma.admissionDocument.findFirst({
    where: {
      id: docId,
      applicationId: app.id,
      schoolId: sid,
      deletedAt: null,
    },
  });
  if (!doc) {
    throw new StaffAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  try {
    const file = resolveLocalAdmissionsDocumentFile(doc);
    await fs.access(file.absolutePath);
    return file;
  } catch (err) {
    if (err instanceof PublicAdmissionsError) {
      throw new StaffAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    }
    throw new StaffAdmissionsError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }
}

/** Assert serialized payload never contains forbidden staff-leak keys for list items / public-ish fields. */
export function assertNoSensitiveAdmissionsFields(payload: unknown): void {
  const json = JSON.stringify(payload);
  const forbidden = [
    "accessTokenHash",
    "resumeOtpHash",
    "storageKey",
    "storageProvider",
    "checksumSha256",
    "data/admissions",
  ];
  for (const key of forbidden) {
    if (json.includes(key)) {
      throw new Error(`Sensitive field leaked in staff payload: ${key}`);
    }
  }
}
