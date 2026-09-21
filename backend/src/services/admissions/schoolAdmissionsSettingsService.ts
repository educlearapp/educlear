/**
 * School Online Admissions settings (OA-03A).
 * Tenant is always authorizedSchoolId from staff JWT→DB — never client schoolId.
 * Does not create Learner/Parent/FamilyAccount.
 * Does not log bank account numbers.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  parseRequiredDocumentConfig,
  RequiredDocumentConfigError,
} from "./requiredDocumentConfig";

export const ADMISSIONS_DEFAULT_CURRENCY = "ZAR";

/** Safe defaults for schools with no settings row yet. Fee amount is intentionally null (not R1600). */
export function defaultAdmissionsSettingsShape(schoolId: string) {
  return {
    id: null as string | null,
    schoolId,
    enabled: false,
    publicSlug: null as string | null,
    applicationsOpenAt: null as string | null,
    applicationsCloseAt: null as string | null,
    intakeYear: null as number | null,
    acceptedGrades: [] as string[],
    admissionFeeRequired: false,
    defaultAdmissionFeeAmount: null as string | null,
    currency: ADMISSIONS_DEFAULT_CURRENCY,
    proofOfPaymentRequired: false,
    paymentVerificationRequired: true,
    requirePaymentVerifiedBeforeAccept: true,
    bankName: null as string | null,
    accountHolder: null as string | null,
    accountNumber: null as string | null,
    branchCode: null as string | null,
    accountType: null as string | null,
    paymentInstructions: null as string | null,
    admissionContactEmail: null as string | null,
    admissionContactPhone: null as string | null,
    requiredDocuments: [] as unknown[],
    applicationQuestions: [] as unknown[],
    notificationRecipientUserIds: [] as string[],
    privacyNoticeVersion: null as string | null,
    declarationText: null as string | null,
    createdAt: null as string | null,
    updatedAt: null as string | null,
  };
}

function decimalToString(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(2);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function asJsonArray(value: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(value)) return [];
  return value as Prisma.InputJsonValue;
}

function validatedRequiredDocuments(value: unknown): Prisma.InputJsonValue {
  try {
    return parseRequiredDocumentConfig(value, { strict: true }) as unknown as Prisma.InputJsonValue;
  } catch (error) {
    if (error instanceof RequiredDocumentConfigError) {
      throw new AdmissionsSettingsValidationError(error.message);
    }
    throw error;
  }
}

function optionalTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function parseOptionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new AdmissionsSettingsValidationError(`Invalid date for ${field}`);
  }
  return d;
}

function parseOptionalFeeAmount(value: unknown): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AdmissionsSettingsValidationError("defaultAdmissionFeeAmount must be a non-negative number");
  }
  return new Prisma.Decimal(n.toFixed(2));
}

function normalizePublicSlug(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const raw = String(value).trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) {
    throw new AdmissionsSettingsValidationError(
      "publicSlug must be lowercase letters, numbers, and hyphens only"
    );
  }
  if (raw.length < 3 || raw.length > 80) {
    throw new AdmissionsSettingsValidationError("publicSlug must be 3–80 characters");
  }
  return raw;
}

export class AdmissionsSettingsValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "AdmissionsSettingsValidationError";
  }
}

export class AdmissionsSettingsConflictError extends Error {
  readonly statusCode = 409;
  readonly code: string;
  constructor(message: string, code = "PUBLIC_SLUG_TAKEN") {
    super(message);
    this.name = "AdmissionsSettingsConflictError";
    this.code = code;
  }
}

export function serializeAdmissionsSettings(
  row: {
    id: string;
    schoolId: string;
    enabled: boolean;
    publicSlug: string | null;
    applicationsOpenAt: Date | null;
    applicationsCloseAt: Date | null;
    intakeYear: number | null;
    acceptedGrades: unknown;
    admissionFeeRequired: boolean;
    defaultAdmissionFeeAmount: Prisma.Decimal | null;
    currency: string;
    proofOfPaymentRequired: boolean;
    paymentVerificationRequired: boolean;
    requirePaymentVerifiedBeforeAccept: boolean;
    bankName: string | null;
    accountHolder: string | null;
    accountNumber: string | null;
    branchCode: string | null;
    accountType: string | null;
    paymentInstructions: string | null;
    admissionContactEmail: string | null;
    admissionContactPhone: string | null;
    requiredDocuments: unknown;
    applicationQuestions: unknown;
    notificationRecipientUserIds: unknown;
    privacyNoticeVersion: string | null;
    declarationText: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null,
  schoolId: string
) {
  if (!row) return defaultAdmissionsSettingsShape(schoolId);
  return {
    id: row.id,
    schoolId: row.schoolId,
    enabled: row.enabled,
    publicSlug: row.publicSlug,
    applicationsOpenAt: row.applicationsOpenAt ? row.applicationsOpenAt.toISOString() : null,
    applicationsCloseAt: row.applicationsCloseAt ? row.applicationsCloseAt.toISOString() : null,
    intakeYear: row.intakeYear,
    acceptedGrades: asStringArray(row.acceptedGrades),
    admissionFeeRequired: row.admissionFeeRequired,
    defaultAdmissionFeeAmount: decimalToString(row.defaultAdmissionFeeAmount),
    currency: row.currency || ADMISSIONS_DEFAULT_CURRENCY,
    proofOfPaymentRequired: row.proofOfPaymentRequired,
    paymentVerificationRequired: row.paymentVerificationRequired,
    requirePaymentVerifiedBeforeAccept: row.requirePaymentVerifiedBeforeAccept,
    bankName: row.bankName,
    accountHolder: row.accountHolder,
    accountNumber: row.accountNumber,
    branchCode: row.branchCode,
    accountType: row.accountType,
    paymentInstructions: row.paymentInstructions,
    admissionContactEmail: row.admissionContactEmail,
    admissionContactPhone: row.admissionContactPhone,
    requiredDocuments: parseRequiredDocumentConfig(row.requiredDocuments) as unknown[],
    applicationQuestions: asJsonArray(row.applicationQuestions) as unknown[],
    notificationRecipientUserIds: asStringArray(row.notificationRecipientUserIds),
    privacyNoticeVersion: row.privacyNoticeVersion,
    declarationText: row.declarationText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSchoolAdmissionsSettings(
  prisma: PrismaClient,
  authorizedSchoolId: string
) {
  const schoolId = String(authorizedSchoolId || "").trim();
  if (!schoolId) throw new AdmissionsSettingsValidationError("Missing school authorization");

  const row = await prisma.schoolAdmissionsSettings.findUnique({
    where: { schoolId },
  });
  return serializeAdmissionsSettings(row, schoolId);
}

export async function upsertSchoolAdmissionsSettings(
  prisma: PrismaClient,
  authorizedSchoolId: string,
  body: Record<string, unknown>
) {
  const schoolId = String(authorizedSchoolId || "").trim();
  if (!schoolId) throw new AdmissionsSettingsValidationError("Missing school authorization");

  // Reject tenant spoofing payloads explicitly (never apply body.schoolId).
  if (body.schoolId !== undefined && String(body.schoolId).trim() && String(body.schoolId).trim() !== schoolId) {
    throw new AdmissionsSettingsValidationError("schoolId in body is not allowed");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });
  if (!school) throw new AdmissionsSettingsValidationError("School not found");

  const existing = await prisma.schoolAdmissionsSettings.findUnique({
    where: { schoolId },
  });

  const publicSlug = normalizePublicSlug(body.publicSlug);
  const enabled =
    body.enabled === undefined ? existing?.enabled ?? false : Boolean(body.enabled);
  const admissionFeeRequired =
    body.admissionFeeRequired === undefined
      ? existing?.admissionFeeRequired ?? false
      : Boolean(body.admissionFeeRequired);
  const defaultAdmissionFeeAmount = parseOptionalFeeAmount(body.defaultAdmissionFeeAmount);
  const currency =
    body.currency === undefined
      ? existing?.currency || ADMISSIONS_DEFAULT_CURRENCY
      : optionalTrimmed(body.currency)?.toUpperCase() || ADMISSIONS_DEFAULT_CURRENCY;

  const resolvedSlug =
    publicSlug === undefined ? existing?.publicSlug ?? null : publicSlug;
  const resolvedFeeAmount =
    defaultAdmissionFeeAmount === undefined
      ? existing?.defaultAdmissionFeeAmount ?? null
      : defaultAdmissionFeeAmount;

  if (enabled === true && !resolvedSlug) {
    throw new AdmissionsSettingsValidationError("publicSlug is required when enabling Online Admissions");
  }
  if (admissionFeeRequired === true && resolvedFeeAmount === null) {
    throw new AdmissionsSettingsValidationError(
      "defaultAdmissionFeeAmount is required when admissionFeeRequired is true"
    );
  }

  const openAt = parseOptionalDate(body.applicationsOpenAt, "applicationsOpenAt");
  const closeAt = parseOptionalDate(body.applicationsCloseAt, "applicationsCloseAt");

  const data: Prisma.SchoolAdmissionsSettingsUncheckedCreateInput = {
    schoolId,
    enabled,
    publicSlug: resolvedSlug,
    applicationsOpenAt:
      openAt === undefined ? existing?.applicationsOpenAt ?? null : openAt,
    applicationsCloseAt:
      closeAt === undefined ? existing?.applicationsCloseAt ?? null : closeAt,
    intakeYear:
      body.intakeYear === undefined
        ? existing?.intakeYear ?? null
        : body.intakeYear === null || body.intakeYear === ""
          ? null
          : Number(body.intakeYear),
    acceptedGrades:
      body.acceptedGrades !== undefined
        ? asStringArray(body.acceptedGrades)
        : asStringArray(existing?.acceptedGrades),
    admissionFeeRequired,
    defaultAdmissionFeeAmount: resolvedFeeAmount,
    currency,
    proofOfPaymentRequired:
      body.proofOfPaymentRequired === undefined
        ? existing?.proofOfPaymentRequired ?? false
        : Boolean(body.proofOfPaymentRequired),
    paymentVerificationRequired:
      body.paymentVerificationRequired === undefined
        ? existing?.paymentVerificationRequired ?? true
        : Boolean(body.paymentVerificationRequired),
    requirePaymentVerifiedBeforeAccept:
      body.requirePaymentVerifiedBeforeAccept === undefined
        ? existing?.requirePaymentVerifiedBeforeAccept ?? true
        : Boolean(body.requirePaymentVerifiedBeforeAccept),
    bankName:
      body.bankName !== undefined ? optionalTrimmed(body.bankName) : existing?.bankName ?? null,
    accountHolder:
      body.accountHolder !== undefined
        ? optionalTrimmed(body.accountHolder)
        : existing?.accountHolder ?? null,
    accountNumber:
      body.accountNumber !== undefined
        ? optionalTrimmed(body.accountNumber)
        : existing?.accountNumber ?? null,
    branchCode:
      body.branchCode !== undefined
        ? optionalTrimmed(body.branchCode)
        : existing?.branchCode ?? null,
    accountType:
      body.accountType !== undefined
        ? optionalTrimmed(body.accountType)
        : existing?.accountType ?? null,
    paymentInstructions:
      body.paymentInstructions !== undefined
        ? optionalTrimmed(body.paymentInstructions)
        : existing?.paymentInstructions ?? null,
    admissionContactEmail:
      body.admissionContactEmail !== undefined
        ? optionalTrimmed(body.admissionContactEmail)
        : existing?.admissionContactEmail ?? null,
    admissionContactPhone:
      body.admissionContactPhone !== undefined
        ? optionalTrimmed(body.admissionContactPhone)
        : existing?.admissionContactPhone ?? null,
    requiredDocuments:
      body.requiredDocuments !== undefined
        ? validatedRequiredDocuments(body.requiredDocuments)
        : asJsonArray(existing?.requiredDocuments),
    applicationQuestions:
      body.applicationQuestions !== undefined
        ? asJsonArray(body.applicationQuestions)
        : asJsonArray(existing?.applicationQuestions),
    notificationRecipientUserIds:
      body.notificationRecipientUserIds !== undefined
        ? asStringArray(body.notificationRecipientUserIds)
        : asStringArray(existing?.notificationRecipientUserIds),
    privacyNoticeVersion:
      body.privacyNoticeVersion !== undefined
        ? optionalTrimmed(body.privacyNoticeVersion)
        : existing?.privacyNoticeVersion ?? null,
    declarationText:
      body.declarationText !== undefined
        ? optionalTrimmed(body.declarationText)
        : existing?.declarationText ?? null,
  };

  if (data.intakeYear !== null && data.intakeYear !== undefined) {
    const y = Number(data.intakeYear);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      throw new AdmissionsSettingsValidationError("intakeYear must be an integer between 2000 and 2100");
    }
    data.intakeYear = y;
  }

  // Merge update: read existing and overlay defined fields from body for PUT semantics
  // that send a full form. Re-build from body as full replace of configurable fields.
  try {
    const row = await prisma.schoolAdmissionsSettings.upsert({
      where: { schoolId },
      create: data,
      update: {
        enabled: data.enabled,
        publicSlug: data.publicSlug,
        applicationsOpenAt: data.applicationsOpenAt,
        applicationsCloseAt: data.applicationsCloseAt,
        intakeYear: data.intakeYear,
        acceptedGrades: data.acceptedGrades,
        admissionFeeRequired: data.admissionFeeRequired,
        defaultAdmissionFeeAmount: data.defaultAdmissionFeeAmount,
        currency: data.currency,
        proofOfPaymentRequired: data.proofOfPaymentRequired,
        paymentVerificationRequired: data.paymentVerificationRequired,
        requirePaymentVerifiedBeforeAccept: data.requirePaymentVerifiedBeforeAccept,
        bankName: data.bankName,
        accountHolder: data.accountHolder,
        accountNumber: data.accountNumber,
        branchCode: data.branchCode,
        accountType: data.accountType,
        paymentInstructions: data.paymentInstructions,
        admissionContactEmail: data.admissionContactEmail,
        admissionContactPhone: data.admissionContactPhone,
        requiredDocuments: data.requiredDocuments,
        applicationQuestions: data.applicationQuestions,
        notificationRecipientUserIds: data.notificationRecipientUserIds,
        privacyNoticeVersion: data.privacyNoticeVersion,
        declarationText: data.declarationText,
      },
    });
    return serializeAdmissionsSettings(row, schoolId);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AdmissionsSettingsConflictError(
        "That public admissions slug is already in use by another school",
        "PUBLIC_SLUG_TAKEN"
      );
    }
    throw err;
  }
}
