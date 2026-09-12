/**
 * Formal Admissions submission (OA-03C).
 * Allocates application number once, snapshots fee, sets SUBMITTED.
 * Payment status: NOT_REQUIRED | AWAITING_PAYMENT (never VERIFIED/paid).
 * No Learner / Parent / FamilyAccount side effects.
 */
import type { PrismaClient, SchoolAdmissionsSettings } from "@prisma/client";

import { ensureApplicationNumber } from "./allocateApplicationNumber";
import {
  applicationInclude,
  loadOwnedApplicationForApplicant,
  serializeApplicantApplication,
  type ApplicantApplicationView,
} from "./draftApplicationService";
import { assertCanCreatePublicApplication } from "./publicAdmissionsConfig";
import { gradeIsAccepted, PublicAdmissionsError } from "./resolvePublicAdmissions";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function answerIsPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

type QuestionDef = { key?: string; label?: string; required?: boolean };

function parseQuestionDefs(settings: SchoolAdmissionsSettings): QuestionDef[] {
  const raw = settings.applicationQuestions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((q) => q && typeof q === "object") as QuestionDef[];
}

export function validateApplicationForSubmit(input: {
  app: {
    intakeYear: number;
    requestedGrade: string | null;
    privacyAcceptedAt: Date | null;
    declarationsAcceptedAt: Date | null;
    learnerCandidate: {
      firstName: string;
      lastName: string;
      birthDate: Date | null;
    } | null;
    guardians: Array<{
      firstName: string;
      surname: string;
      cellNo: string | null;
      email: string | null;
      isPrimary: boolean;
      isPayingPerson: boolean;
    }>;
    answers: Array<{ questionKey: string; valueJson: unknown }>;
  };
  settings: SchoolAdmissionsSettings;
}): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  const { app, settings } = input;

  if (!app.learnerCandidate || !clean(app.learnerCandidate.firstName)) {
    errors.push({ field: "learner.firstName", message: "Learner first name is required" });
  }
  if (!app.learnerCandidate || !clean(app.learnerCandidate.lastName)) {
    errors.push({ field: "learner.lastName", message: "Learner last name is required" });
  }
  if (!app.learnerCandidate?.birthDate) {
    errors.push({ field: "learner.birthDate", message: "Learner date of birth is required" });
  }

  if (!clean(app.requestedGrade)) {
    errors.push({ field: "requestedGrade", message: "Requested grade is required" });
  } else if (!gradeIsAccepted(settings, app.requestedGrade)) {
    errors.push({ field: "requestedGrade", message: "Requested grade is not accepted for this school" });
  }

  const settingsYear = settings.intakeYear;
  if (settingsYear != null && app.intakeYear !== settingsYear) {
    errors.push({
      field: "intakeYear",
      message: `Intake year must be ${settingsYear}`,
    });
  }

  if (!app.guardians.length) {
    errors.push({ field: "guardians", message: "At least one guardian is required" });
  } else {
    const primary = app.guardians.filter((g) => g.isPrimary);
    if (primary.length !== 1) {
      errors.push({ field: "guardians.isPrimary", message: "Exactly one primary guardian is required" });
    }
    for (let i = 0; i < app.guardians.length; i += 1) {
      const g = app.guardians[i];
      if (!clean(g.firstName)) {
        errors.push({ field: `guardians[${i}].firstName`, message: "Guardian first name is required" });
      }
      if (!clean(g.surname)) {
        errors.push({ field: `guardians[${i}].surname`, message: "Guardian surname is required" });
      }
      if (!clean(g.cellNo) && !clean(g.email)) {
        errors.push({
          field: `guardians[${i}].contact`,
          message: "Guardian cell number or email is required",
        });
      }
    }
    if (!app.guardians.some((g) => g.isPayingPerson)) {
      errors.push({
        field: "guardians.isPayingPerson",
        message: "At least one paying person must be designated",
      });
    }
  }

  if (!app.privacyAcceptedAt) {
    errors.push({ field: "privacyAccepted", message: "Privacy notice acceptance is required" });
  }
  if (!app.declarationsAcceptedAt) {
    errors.push({ field: "declarationsAccepted", message: "Declarations acceptance is required" });
  }

  const requiredQuestions = parseQuestionDefs(settings).filter((q) => q.required && clean(q.key));
  const answerMap = new Map(app.answers.map((a) => [a.questionKey, a.valueJson]));
  for (const q of requiredQuestions) {
    const key = clean(q.key);
    if (!answerIsPresent(answerMap.get(key))) {
      errors.push({
        field: `answers.${key}`,
        message: `Required answer missing: ${clean(q.label) || key}`,
      });
    }
  }

  // Document requirements deferred to secure document storage (later OA slice).
  return errors;
}

export type SubmitApplicationResult = {
  application: ApplicantApplicationView;
  /** Present when fee required and bank config incomplete — payment UI must not pretend EFT can proceed. */
  paymentInstructionsAvailable: boolean;
  bankConfigurationIncomplete: boolean;
};

function bankConfigComplete(settings: SchoolAdmissionsSettings): boolean {
  return Boolean(
    clean(settings.bankName) &&
      clean(settings.accountHolder) &&
      clean(settings.accountNumber) &&
      clean(settings.branchCode)
  );
}

/**
 * Submit DRAFT → SUBMITTED with number + fee snapshot.
 * Concurrent/repeat submits are idempotent (row lock + status check).
 */
export async function submitApplication(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  now: Date = new Date()
): Promise<SubmitApplicationResult> {
  const { app, schoolId, settings } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken,
    now
  );

  // Idempotent: already submitted → return current state (no new number / fee rewrite)
  if (app.status === "SUBMITTED" || app.status === "UNDER_REVIEW" || app.status === "INFO_REQUESTED") {
    return {
      application: serializeApplicantApplication(app),
      paymentInstructionsAvailable:
        Boolean(app.feeRequired) && bankConfigComplete(settings) && Boolean(app.applicationNumber),
      bankConfigurationIncomplete: Boolean(app.feeRequired) && !bankConfigComplete(settings),
    };
  }

  if (app.status !== "DRAFT") {
    throw new PublicAdmissionsError(
      "Application cannot be submitted in its current state",
      409,
      "INVALID_STATUS"
    );
  }

  assertCanCreatePublicApplication(settings, now);

  const validationErrors = validateApplicationForSubmit({ app, settings });
  if (validationErrors.length) {
    throw new PublicAdmissionsError(
      "Application is incomplete",
      400,
      "VALIDATION_FAILED",
      validationErrors
    );
  }

  const feeRequired = Boolean(settings.admissionFeeRequired);
  if (feeRequired && settings.defaultAdmissionFeeAmount == null) {
    throw new PublicAdmissionsError(
      "Admissions fee is required but not configured for this school",
      503,
      "FEE_NOT_CONFIGURED"
    );
  }

  const feeAmount = feeRequired ? settings.defaultAdmissionFeeAmount : null;
  const feeCurrency = settings.currency || "ZAR";
  const paymentStatus = feeRequired ? "AWAITING_PAYMENT" : "NOT_REQUIRED";

  const submitted = await prisma.$transaction(async (tx) => {
    // Row lock — serialize concurrent submits on this application
    const locked = await tx.$queryRaw<Array<{ id: string; status: string; applicationNumber: string | null }>>`
      SELECT id, status::text AS status, "applicationNumber"
      FROM "AdmissionApplication"
      WHERE id = ${app.id} AND "schoolId" = ${schoolId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row) {
      throw new PublicAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
    }

    if (row.status !== "DRAFT") {
      const existing = await tx.admissionApplication.findUniqueOrThrow({
        where: { id: app.id },
        include: applicationInclude,
      });
      return existing;
    }

    const applicationNumber = await ensureApplicationNumber(tx, {
      id: app.id,
      schoolId,
      intakeYear: app.intakeYear,
      applicationNumber: row.applicationNumber,
    });

    await tx.admissionApplication.update({
      where: { id: app.id },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        lastApplicantActivityAt: now,
        applicationNumber,
        feeRequired,
        feeAmount: feeAmount ?? null,
        feeCurrency: feeRequired ? feeCurrency : null,
        feeSnapshotAt: now,
        privacyNoticeVersion: app.privacyNoticeVersion || settings.privacyNoticeVersion,
      },
    });

    const existingFee = await tx.admissionFeeRecord.findUnique({
      where: { applicationId: app.id },
    });
    if (!existingFee) {
      await tx.admissionFeeRecord.create({
        data: {
          schoolId,
          applicationId: app.id,
          required: feeRequired,
          amount: feeAmount ?? null,
          currency: feeCurrency,
          paymentStatus,
          paymentReference: applicationNumber,
        },
      });
      await tx.admissionPaymentHistory.create({
        data: {
          schoolId,
          applicationId: app.id,
          fromStatus: null,
          toStatus: paymentStatus,
          actorType: "SYSTEM",
          reason: "Fee record created on submission",
        },
      });
    }

    await tx.admissionStatusHistory.create({
      data: {
        schoolId,
        applicationId: app.id,
        fromStatus: "DRAFT",
        toStatus: "SUBMITTED",
        actorType: "APPLICANT",
        reason: "Application submitted",
      },
    });

    await tx.admissionAuditEvent.create({
      data: {
        schoolId,
        applicationId: app.id,
        eventType: "APPLICATION_SUBMITTED",
        actorType: "APPLICANT",
        metadataJson: {
          applicationNumber,
          feeRequired,
          // amount omitted from audit to reduce sensitive financial logging surface
        },
      },
    });

    return tx.admissionApplication.findUniqueOrThrow({
      where: { id: app.id },
      include: applicationInclude,
    });
  });

  const view = serializeApplicantApplication(submitted);
  const feeReq = Boolean(view.feeRequired);
  return {
    application: view,
    paymentInstructionsAvailable: feeReq && bankConfigComplete(settings),
    bankConfigurationIncomplete: feeReq && !bankConfigComplete(settings),
  };
}
