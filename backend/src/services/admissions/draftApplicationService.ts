/**
 * Draft application create / load for public applicants (OA-03B service layer).
 * Does NOT create Learner, Parent, FamilyAccount, or finance baseline.
 * Does NOT allocate applicationNumber on draft create (issued on later submit).
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  applicantTokenExpiry,
  generateApplicantAccessToken,
  hashApplicantAccessToken,
  verifyApplicantAccessToken,
} from "./applicantAccessToken";
import { gradeIsAccepted } from "./resolvePublicAdmissions";
import {
  assertCanCreatePublicApplication,
  PublicAdmissionsError,
  resolvePublicAdmissionsBySlug,
} from "./publicAdmissionsConfig";
import {
  reconcileDraftFinancialSigner,
  removePrivateSignatureFiles,
  retargetDraftFinancialSigner,
} from "./financialAgreementService";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new PublicAdmissionsError("Invalid date", 400, "INVALID_DATE");
  }
  return d;
}

export type CreateDraftApplicationInput = {
  requestedGrade?: string | null;
  intakeYear?: number | null;
  learner?: {
    firstName?: string;
    lastName?: string;
    nickname?: string | null;
    birthDate?: string | null;
    gender?: string | null;
    idNumber?: string | null;
    homeLanguage?: string | null;
    citizenship?: string | null;
    homeAddress?: string | null;
    allergies?: string | null;
    medicalAlert?: string | null;
    previousSchoolName?: string | null;
    notes?: string | null;
  } | null;
  guardians?: Array<{
    title?: string | null;
    firstName?: string;
    surname?: string;
    relationship?: string | null;
    idNumber?: string | null;
    cellNo?: string | null;
    email?: string | null;
    homeAddress?: string | null;
    employer?: string | null;
    isPrimary?: boolean;
    isPayingPerson?: boolean;
    sortOrder?: number;
  }> | null;
  declaredExistingSibling?: boolean;
  declaredSiblingLearnerName?: string | null;
  declaredSiblingAdmissionNo?: string | null;
  declaredExistingFamily?: boolean;
  /** Rejected if present and mismatches resolved school. */
  schoolId?: unknown;
};

export type ApplicantApplicationView = {
  publicAccessId: string;
  status: string;
  /** Applicant-facing staff message (e.g. info request / decline reason). Never staff internal notes. */
  statusReason: string | null;
  intakeYear: number;
  requestedGrade: string | null;
  applicationNumber: string | null;
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
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  feeRecord: {
    required: boolean;
    amount: string | null;
    currency: string;
    paymentStatus: string;
    paymentReference: string | null;
  } | null;
  financialAgreement: {
    signed: boolean;
    signerFullName: string | null;
    acceptances: Array<{ kind: string; contentSha256: string }>;
  };
};

function dec(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(2);
}

export function serializeApplicantApplication(app: {
  publicAccessId: string;
  status: string;
  statusReason?: string | null;
  intakeYear: number;
  requestedGrade: string | null;
  applicationNumber: string | null;
  feeRequired: boolean;
  feeAmount: Prisma.Decimal | null;
  feeCurrency: string | null;
  feeSnapshotAt: Date | null;
  declaredExistingSibling: boolean;
  declaredSiblingLearnerName: string | null;
  declaredSiblingAdmissionNo: string | null;
  declaredExistingFamily: boolean;
  privacyAcceptedAt: Date | null;
  declarationsAcceptedAt: Date | null;
  privacyNoticeVersion: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  learnerCandidate: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    birthDate: Date | null;
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
    valueJson: Prisma.JsonValue | null;
  }>;
  feeRecord: {
    required: boolean;
    amount: Prisma.Decimal | null;
    currency: string;
    paymentStatus: string;
    paymentReference: string | null;
  } | null;
  financialAcceptances?: Array<{
    kind: string;
    contentSha256: string;
    signerFullNameSnapshot: string;
  }>;
}): ApplicantApplicationView {
  return {
    publicAccessId: app.publicAccessId,
    status: app.status,
    statusReason: app.statusReason ?? null,
    intakeYear: app.intakeYear,
    requestedGrade: app.requestedGrade,
    applicationNumber: app.applicationNumber,
    feeRequired: app.feeRequired,
    feeAmount: dec(app.feeAmount),
    feeCurrency: app.feeCurrency,
    feeSnapshotAt: app.feeSnapshotAt ? app.feeSnapshotAt.toISOString() : null,
    declaredExistingSibling: app.declaredExistingSibling,
    declaredSiblingLearnerName: app.declaredSiblingLearnerName,
    declaredSiblingAdmissionNo: app.declaredSiblingAdmissionNo,
    declaredExistingFamily: app.declaredExistingFamily,
    privacyAcceptedAt: app.privacyAcceptedAt ? app.privacyAcceptedAt.toISOString() : null,
    declarationsAcceptedAt: app.declarationsAcceptedAt
      ? app.declarationsAcceptedAt.toISOString()
      : null,
    privacyNoticeVersion: app.privacyNoticeVersion,
    submittedAt: app.submittedAt ? app.submittedAt.toISOString() : null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    learner: app.learnerCandidate
      ? {
          firstName: app.learnerCandidate.firstName,
          lastName: app.learnerCandidate.lastName,
          nickname: app.learnerCandidate.nickname,
          birthDate: app.learnerCandidate.birthDate
            ? app.learnerCandidate.birthDate.toISOString().slice(0, 10)
            : null,
          gender: app.learnerCandidate.gender,
          idNumber: app.learnerCandidate.idNumber,
          homeLanguage: app.learnerCandidate.homeLanguage,
          citizenship: app.learnerCandidate.citizenship,
          homeAddress: app.learnerCandidate.homeAddress,
          allergies: app.learnerCandidate.allergies,
          medicalAlert: app.learnerCandidate.medicalAlert,
          previousSchoolName: app.learnerCandidate.previousSchoolName,
          notes: app.learnerCandidate.notes,
        }
      : null,
    guardians: (app.guardians || []).map((g) => ({
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
    answers: (app.answers || []).map((a) => ({
      questionKey: a.questionKey,
      questionLabelSnapshot: a.questionLabelSnapshot,
      valueJson: a.valueJson,
    })),
    feeRecord: app.feeRecord
      ? {
          required: app.feeRecord.required,
          amount: dec(app.feeRecord.amount),
          currency: app.feeRecord.currency,
          paymentStatus: app.feeRecord.paymentStatus,
          paymentReference: app.feeRecord.paymentReference,
        }
      : null,
    financialAgreement: {
      signed: (app.financialAcceptances || []).length >= 2,
      signerFullName: app.financialAcceptances?.[0]?.signerFullNameSnapshot ?? null,
      acceptances: (app.financialAcceptances || []).map((row) => ({
        kind: row.kind,
        contentSha256: row.contentSha256,
      })),
    },
  };
}

const applicationInclude = {
  learnerCandidate: true,
  guardians: { orderBy: { sortOrder: "asc" as const } },
  answers: true,
  feeRecord: true,
  financialAcceptances: {
    select: { kind: true, contentSha256: true, signerFullNameSnapshot: true },
  },
} as const;

export { applicationInclude };

/** Top-level keys applicants may send on draft PATCH. */
export const APPLICANT_DRAFT_ALLOWED_KEYS = new Set([
  "requestedGrade",
  "intakeYear",
  "learner",
  "guardians",
  "answers",
  "declaredExistingSibling",
  "declaredSiblingLearnerName",
  "declaredSiblingAdmissionNo",
  "declaredExistingFamily",
  "privacyAccepted",
  "declarationsAccepted",
  "privacyNoticeVersion",
]);

/** Explicitly blocked / internal fields — presence is always rejected. */
export const APPLICANT_DRAFT_FORBIDDEN_KEYS = new Set([
  "schoolId",
  "id",
  "status",
  "applicationNumber",
  "paymentStatus",
  "feeRequired",
  "feeAmount",
  "feeCurrency",
  "feeSnapshotAt",
  "accessTokenHash",
  "accessTokenExpiresAt",
  "publicAccessId",
  "promotedLearnerId",
  "promotedFamilyAccountId",
  "acceptedByUserId",
  "acceptedAt",
  "declinedAt",
  "withdrawnAt",
  "cancelledAt",
  "statusReason",
  "staffMatchedFamilyAccountId",
  "staffMatchDecision",
  "submittedAt",
  "createdAt",
  "updatedAt",
  "lastApplicantActivityAt",
  "feeRecord",
  "statusHistory",
  "auditEvents",
  "staffNotes",
  "documents",
  "financialAgreementRequired",
  "financialAcceptances",
  "signatureFileKey",
]);

export type UpdateDraftApplicationInput = CreateDraftApplicationInput & {
  answers?: Array<{
    questionKey: string;
    questionLabelSnapshot?: string;
    valueJson?: unknown;
  }> | null;
  privacyAccepted?: boolean;
  declarationsAccepted?: boolean;
  privacyNoticeVersion?: string | null;
};

function rejectProtectedOrUnknownKeys(body: Record<string, unknown>) {
  const keys = Object.keys(body);
  const forbidden = keys.filter((k) => APPLICANT_DRAFT_FORBIDDEN_KEYS.has(k));
  if (forbidden.length) {
    throw new PublicAdmissionsError(
      "Protected fields cannot be modified",
      400,
      "PROTECTED_FIELD",
      forbidden.map((field) => ({ field, message: "This field cannot be modified by applicants" }))
    );
  }
  const unknown = keys.filter((k) => !APPLICANT_DRAFT_ALLOWED_KEYS.has(k));
  if (unknown.length) {
    throw new PublicAdmissionsError(
      "Unknown or disallowed fields",
      400,
      "DISALLOWED_FIELD",
      unknown.map((field) => ({ field, message: "Field is not allowed on draft update" }))
    );
  }
}

type OwnedApplication = Prisma.AdmissionApplicationGetPayload<{ include: typeof applicationInclude }>;

/**
 * Load owned application for mutation. Generic 404 on any auth/tenant failure.
 */
export async function loadOwnedApplicationForApplicant(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  now: Date = new Date()
): Promise<{ app: OwnedApplication; schoolId: string; settings: Awaited<ReturnType<typeof resolvePublicAdmissionsBySlug>>["settings"] }> {
  const accessId = clean(publicAccessId);
  const token = clean(accessToken);
  if (!accessId || !token) {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  let resolved;
  try {
    resolved = await resolvePublicAdmissionsBySlug(prisma, schoolSlug);
  } catch {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const app = await prisma.admissionApplication.findFirst({
    where: {
      publicAccessId: accessId,
      schoolId: resolved.school.id,
    },
    include: applicationInclude,
  });

  if (
    !app ||
    !app.accessTokenHash ||
    !verifyApplicantAccessToken(token, app.accessTokenHash) ||
    (app.accessTokenExpiresAt && app.accessTokenExpiresAt.getTime() < now.getTime())
  ) {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  return { app, schoolId: resolved.school.id, settings: resolved.settings };
}

/**
 * PATCH allow-listed applicant fields.
 * Editable while DRAFT or INFO_REQUESTED (OA-03H response loop).
 * Never mutates status / statusReason / payment / staff fields.
 */
export async function updateDraftApplication(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  body: UpdateDraftApplicationInput,
  now: Date = new Date()
): Promise<ApplicantApplicationView> {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (raw.schoolId !== undefined && raw.schoolId !== null && String(raw.schoolId).trim() !== "") {
    throw new PublicAdmissionsError("schoolId is not accepted on public admissions", 400, "SCHOOL_ID_NOT_ALLOWED");
  }
  rejectProtectedOrUnknownKeys(raw);

  const { app, schoolId, settings } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken,
    now
  );

  if (app.status !== "DRAFT" && app.status !== "INFO_REQUESTED") {
    throw new PublicAdmissionsError(
      "Application cannot be edited in its current state",
      409,
      "APPLICATION_NOT_EDITABLE"
    );
  }

  const respondingToInfoRequest = app.status === "INFO_REQUESTED";

  const requestedGrade =
    raw.requestedGrade !== undefined ? clean(raw.requestedGrade) || null : undefined;
  if (requestedGrade && !gradeIsAccepted(settings, requestedGrade)) {
    throw new PublicAdmissionsError("Requested grade is not accepted", 400, "GRADE_NOT_ACCEPTED");
  }

  let intakeYear: number | undefined;
  if (raw.intakeYear !== undefined) {
    if (raw.intakeYear === null || raw.intakeYear === "") {
      throw new PublicAdmissionsError("intakeYear is required", 400, "INTAKE_YEAR_REQUIRED");
    }
    intakeYear = Number(raw.intakeYear);
    if (!Number.isInteger(intakeYear) || intakeYear < 2000 || intakeYear > 2100) {
      throw new PublicAdmissionsError("Invalid intakeYear", 400, "INVALID_INTAKE_YEAR");
    }
  }

  const learner = raw.learner as UpdateDraftApplicationInput["learner"] | undefined;
  const guardians = raw.guardians as UpdateDraftApplicationInput["guardians"] | undefined;
  const answers = raw.answers as UpdateDraftApplicationInput["answers"] | undefined;

  const privacyAccepted =
    raw.privacyAccepted === undefined ? undefined : Boolean(raw.privacyAccepted);
  const declarationsAccepted =
    raw.declarationsAccepted === undefined ? undefined : Boolean(raw.declarationsAccepted);

  // Consent provenance: during INFO_REQUESTED do not overwrite existing acceptance timestamps.
  const applyPrivacyAccept =
    privacyAccepted === true && (!respondingToInfoRequest || !app.privacyAcceptedAt);
  const applyDeclarationsAccept =
    declarationsAccepted === true && (!respondingToInfoRequest || !app.declarationsAcceptedAt);

  const result = await prisma.$transaction(async (tx) => {
    const removedSignatureKeys: string[] = [];
    await tx.admissionApplication.update({
      where: { id: app.id },
      data: {
        ...(requestedGrade !== undefined ? { requestedGrade } : {}),
        ...(intakeYear !== undefined ? { intakeYear } : {}),
        ...(raw.declaredExistingSibling !== undefined
          ? { declaredExistingSibling: Boolean(raw.declaredExistingSibling) }
          : {}),
        ...(raw.declaredSiblingLearnerName !== undefined
          ? { declaredSiblingLearnerName: clean(raw.declaredSiblingLearnerName) || null }
          : {}),
        ...(raw.declaredSiblingAdmissionNo !== undefined
          ? { declaredSiblingAdmissionNo: clean(raw.declaredSiblingAdmissionNo) || null }
          : {}),
        ...(raw.declaredExistingFamily !== undefined
          ? { declaredExistingFamily: Boolean(raw.declaredExistingFamily) }
          : {}),
        ...(applyPrivacyAccept
          ? {
              privacyAcceptedAt: now,
              privacyNoticeVersion:
                clean(raw.privacyNoticeVersion) || settings.privacyNoticeVersion || app.privacyNoticeVersion,
            }
          : {}),
        ...(applyDeclarationsAccept ? { declarationsAcceptedAt: now } : {}),
        lastApplicantActivityAt: now,
      },
    });

    if (learner !== undefined && learner !== null) {
      const learnerData = {
        firstName: clean(learner.firstName) || "",
        lastName: clean(learner.lastName) || "",
        nickname: clean(learner.nickname) || null,
        birthDate: optionalDate(learner.birthDate),
        gender: clean(learner.gender) || null,
        idNumber: clean(learner.idNumber) || null,
        homeLanguage: clean(learner.homeLanguage) || null,
        citizenship: clean(learner.citizenship) || null,
        homeAddress: clean(learner.homeAddress) || null,
        allergies: clean(learner.allergies) || null,
        medicalAlert: clean(learner.medicalAlert) || null,
        previousSchoolName: clean(learner.previousSchoolName) || null,
        notes: clean(learner.notes) || null,
      };
      if (app.learnerCandidate) {
        await tx.admissionLearnerCandidate.update({
          where: { applicationId: app.id },
          data: learnerData,
        });
      } else {
        await tx.admissionLearnerCandidate.create({
          data: { schoolId, applicationId: app.id, ...learnerData },
        });
      }
    }

    if (guardians !== undefined) {
      const list = Array.isArray(guardians) ? guardians : [];
      if (app.status === "DRAFT") {
        const removed = await reconcileDraftFinancialSigner(
          tx,
          schoolId,
          app.id,
          list.map((guardian) => ({
            firstName: clean(guardian.firstName) || "",
            surname: clean(guardian.surname) || "",
            idNumber: clean(guardian.idNumber) || null,
            isPayingPerson: Boolean(guardian.isPayingPerson),
          }))
        );
        removedSignatureKeys.push(...removed);
      }
      await tx.admissionGuardian.deleteMany({ where: { applicationId: app.id } });
      if (list.length) {
        await tx.admissionGuardian.createMany({
          data: list.map((g, index) => ({
            schoolId,
            applicationId: app.id,
            title: clean(g.title) || null,
            firstName: clean(g.firstName) || "",
            surname: clean(g.surname) || "",
            relationship: clean(g.relationship) || null,
            idNumber: clean(g.idNumber) || null,
            cellNo: clean(g.cellNo) || null,
            email: clean(g.email) || null,
            homeAddress: clean(g.homeAddress) || null,
            employer: clean(g.employer) || null,
            isPrimary: g.isPrimary !== undefined ? Boolean(g.isPrimary) : index === 0,
            isPayingPerson: Boolean(g.isPayingPerson),
            sortOrder: Number.isInteger(g.sortOrder) ? Number(g.sortOrder) : index,
          })),
        });
      }
      if (app.status === "DRAFT" && removedSignatureKeys.length === 0) {
        const payers = await tx.admissionGuardian.findMany({
          where: { schoolId, applicationId: app.id, isPayingPerson: true },
          select: { id: true },
        });
        if (payers.length === 1) {
          await retargetDraftFinancialSigner(tx, schoolId, app.id, payers[0].id);
        } else {
          removedSignatureKeys.push(
            ...(await reconcileDraftFinancialSigner(tx, schoolId, app.id, []))
          );
        }
      }
    }

    if (answers !== undefined) {
      const list = Array.isArray(answers) ? answers : [];
      for (const a of list) {
        const questionKey = clean(a.questionKey);
        if (!questionKey) continue;
        const label =
          clean(a.questionLabelSnapshot) ||
          questionKey;
        await tx.admissionAnswer.upsert({
          where: {
            applicationId_questionKey: { applicationId: app.id, questionKey },
          },
          create: {
            schoolId,
            applicationId: app.id,
            questionKey,
            questionLabelSnapshot: label,
            valueJson:
              a.valueJson === undefined ? Prisma.JsonNull : (a.valueJson as Prisma.InputJsonValue),
          },
          update: {
            questionLabelSnapshot: label,
            valueJson:
              a.valueJson === undefined ? undefined : (a.valueJson as Prisma.InputJsonValue),
          },
        });
      }
    }

    await tx.admissionAuditEvent.create({
      data: {
        schoolId,
        applicationId: app.id,
        eventType: respondingToInfoRequest
          ? "APPLICATION_UPDATED_WHILE_INFO_REQUESTED"
          : "APPLICATION_DRAFT_UPDATED",
        actorType: "APPLICANT",
        metadataJson: { keys: Object.keys(raw) },
      },
    });

    const updated = await tx.admissionApplication.findUniqueOrThrow({
      where: { id: app.id },
      include: applicationInclude,
    });
    return { updated, removedSignatureKeys };
  });

  await removePrivateSignatureFiles(result.removedSignatureKeys);
  return serializeApplicantApplication(result.updated);
}

/**
 * Create a DRAFT application for the school resolved from publicSlug.
 * Returns plaintext access token once (caller must set cookie / store client-side securely).
 */
export async function createDraftApplication(
  prisma: PrismaClient,
  schoolSlug: string,
  body: CreateDraftApplicationInput,
  now: Date = new Date()
): Promise<{ application: ApplicantApplicationView; accessToken: string; accessTokenExpiresAt: string }> {
  if (body.schoolId !== undefined && body.schoolId !== null && String(body.schoolId).trim() !== "") {
    throw new PublicAdmissionsError("schoolId is not accepted on public admissions", 400, "SCHOOL_ID_NOT_ALLOWED");
  }

  const resolved = await resolvePublicAdmissionsBySlug(prisma, schoolSlug);
  assertCanCreatePublicApplication(resolved.settings, now);

  const schoolId = resolved.school.id;
  const intakeYear =
    body.intakeYear !== undefined && body.intakeYear !== null
      ? Number(body.intakeYear)
      : resolved.settings.intakeYear;
  if (!intakeYear || !Number.isInteger(intakeYear) || intakeYear < 2000 || intakeYear > 2100) {
    throw new PublicAdmissionsError("intakeYear is required", 400, "INTAKE_YEAR_REQUIRED");
  }

  const requestedGrade = clean(body.requestedGrade) || null;
  if (requestedGrade && !gradeIsAccepted(resolved.settings, requestedGrade)) {
    throw new PublicAdmissionsError("Requested grade is not accepted", 400, "GRADE_NOT_ACCEPTED");
  }

  const plaintextToken = generateApplicantAccessToken();
  const tokenHash = hashApplicantAccessToken(plaintextToken);
  const tokenExpires = applicantTokenExpiry(now);

  const learner = body.learner || {};
  const guardians = Array.isArray(body.guardians) ? body.guardians : [];

  const created = await prisma.$transaction(async (tx) => {
    const app = await tx.admissionApplication.create({
      data: {
        schoolId,
        status: "DRAFT",
        intakeYear,
        requestedGrade,
        accessTokenHash: tokenHash,
        accessTokenExpiresAt: tokenExpires,
        declaredExistingSibling: Boolean(body.declaredExistingSibling),
        declaredSiblingLearnerName: clean(body.declaredSiblingLearnerName) || null,
        declaredSiblingAdmissionNo: clean(body.declaredSiblingAdmissionNo) || null,
        declaredExistingFamily: Boolean(body.declaredExistingFamily),
        lastApplicantActivityAt: now,
        learnerCandidate: {
          create: {
            schoolId,
            firstName: clean(learner.firstName) || "",
            lastName: clean(learner.lastName) || "",
            nickname: clean(learner.nickname) || null,
            birthDate: optionalDate(learner.birthDate),
            gender: clean(learner.gender) || null,
            idNumber: clean(learner.idNumber) || null,
            homeLanguage: clean(learner.homeLanguage) || null,
            citizenship: clean(learner.citizenship) || null,
            homeAddress: clean(learner.homeAddress) || null,
            allergies: clean(learner.allergies) || null,
            medicalAlert: clean(learner.medicalAlert) || null,
            previousSchoolName: clean(learner.previousSchoolName) || null,
            notes: clean(learner.notes) || null,
          },
        },
        guardians: {
          create: guardians.map((g, index) => ({
            schoolId,
            title: clean(g.title) || null,
            firstName: clean(g.firstName) || "",
            surname: clean(g.surname) || "",
            relationship: clean(g.relationship) || null,
            idNumber: clean(g.idNumber) || null,
            cellNo: clean(g.cellNo) || null,
            email: clean(g.email) || null,
            homeAddress: clean(g.homeAddress) || null,
            employer: clean(g.employer) || null,
            isPrimary: g.isPrimary !== undefined ? Boolean(g.isPrimary) : index === 0,
            isPayingPerson: Boolean(g.isPayingPerson),
            sortOrder: Number.isInteger(g.sortOrder) ? Number(g.sortOrder) : index,
          })),
        },
        statusHistory: {
          create: {
            schoolId,
            fromStatus: null,
            toStatus: "DRAFT",
            actorType: "APPLICANT",
            reason: "Application draft created",
          },
        },
        auditEvents: {
          create: {
            schoolId,
            eventType: "APPLICATION_DRAFT_CREATED",
            actorType: "APPLICANT",
            metadataJson: {
              intakeYear,
              requestedGrade,
              // no PII
            },
          },
        },
      },
      include: applicationInclude,
    });
    return app;
  });

  return {
    application: serializeApplicantApplication(created),
    accessToken: plaintextToken,
    accessTokenExpiresAt: tokenExpires.toISOString(),
  };
}

export type ApplicantAccessContext = {
  schoolId: string;
  publicAccessId: string;
  applicationId: string;
};

/**
 * Load application only when slug-resolved school + publicAccessId + valid token match.
 * Invalid/expired/cross-school → generic 404 (no enumeration).
 */
export async function getApplicationForApplicant(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  now: Date = new Date()
): Promise<ApplicantApplicationView> {
  const accessId = clean(publicAccessId);
  const token = clean(accessToken);
  if (!accessId || !token) {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  let resolved;
  try {
    resolved = await resolvePublicAdmissionsBySlug(prisma, schoolSlug);
  } catch {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const app = await prisma.admissionApplication.findFirst({
    where: {
      publicAccessId: accessId,
      schoolId: resolved.school.id,
    },
    include: applicationInclude,
  });

  if (!app) {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  if (
    !app.accessTokenHash ||
    !verifyApplicantAccessToken(token, app.accessTokenHash) ||
    (app.accessTokenExpiresAt && app.accessTokenExpiresAt.getTime() < now.getTime())
  ) {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  await prisma.admissionApplication.update({
    where: { id: app.id },
    data: { lastApplicantActivityAt: now },
  });

  return serializeApplicantApplication(app);
}

/**
 * Resolve applicant access context for middleware (slug + accessId + token).
 */
export async function resolveApplicantAccessContext(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  now: Date = new Date()
): Promise<ApplicantAccessContext> {
  const accessId = clean(publicAccessId);
  const token = clean(accessToken);
  if (!accessId || !token) {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  let resolved;
  try {
    resolved = await resolvePublicAdmissionsBySlug(prisma, schoolSlug);
  } catch {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const app = await prisma.admissionApplication.findFirst({
    where: { publicAccessId: accessId, schoolId: resolved.school.id },
    select: {
      id: true,
      schoolId: true,
      publicAccessId: true,
      accessTokenHash: true,
      accessTokenExpiresAt: true,
    },
  });

  if (
    !app ||
    !app.accessTokenHash ||
    !verifyApplicantAccessToken(token, app.accessTokenHash) ||
    (app.accessTokenExpiresAt && app.accessTokenExpiresAt.getTime() < now.getTime())
  ) {
    throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  return {
    schoolId: app.schoolId,
    publicAccessId: app.publicAccessId,
    applicationId: app.id,
  };
}
