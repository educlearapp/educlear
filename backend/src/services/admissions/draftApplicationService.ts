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
};

function dec(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(2);
}

export function serializeApplicantApplication(app: {
  publicAccessId: string;
  status: string;
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
}): ApplicantApplicationView {
  return {
    publicAccessId: app.publicAccessId,
    status: app.status,
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
  };
}

const applicationInclude = {
  learnerCandidate: true,
  guardians: { orderBy: { sortOrder: "asc" as const } },
  answers: true,
  feeRecord: true,
} as const;

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
