/**
 * Public admissions config + availability (OA-03B).
 * Extends resolvePublicAdmissionsBySlug — never exposes bank details or internal schoolId.
 */
import type { PrismaClient, SchoolAdmissionsSettings } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  asStringArray,
  assertAdmissionsAcceptingApplications,
  isAdmissionsWindowOpen,
  PublicAdmissionsError,
  resolvePublicAdmissionsBySlug,
} from "./resolvePublicAdmissions";

function decimalToString(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(2);
}

export type PublicAdmissionsConfig = {
  /** Public slug used in the URL — not the internal school cuid. */
  publicSlug: string;
  schoolDisplayName: string;
  branding: {
    logoUrl: string | null;
    primaryColor: string | null;
  };
  enabled: boolean;
  acceptingApplications: boolean;
  applicationsOpenAt: string | null;
  applicationsCloseAt: string | null;
  intakeYear: number | null;
  acceptedGrades: string[];
  admissionFeeRequired: boolean;
  admissionFeeAmount: string | null;
  currency: string;
  proofOfPaymentRequired: boolean;
  paymentVerificationRequired: boolean;
  requirePaymentVerifiedBeforeAccept: boolean;
  admissionContactEmail: string | null;
  admissionContactPhone: string | null;
  requiredDocuments: unknown[];
  applicationQuestions: unknown[];
  privacyNoticeVersion: string | null;
  declarationText: string | null;
};

function asJsonArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value;
}

export function buildPublicAdmissionsConfig(input: {
  publicSlug: string;
  schoolName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  settings: SchoolAdmissionsSettings;
  now?: Date;
}): PublicAdmissionsConfig {
  const { settings } = input;
  const now = input.now || new Date();
  const windowOpen = isAdmissionsWindowOpen(settings, now);
  const acceptingApplications = Boolean(settings.enabled) && windowOpen;

  return {
    publicSlug: input.publicSlug,
    schoolDisplayName: input.schoolName,
    branding: {
      logoUrl: input.logoUrl,
      primaryColor: input.primaryColor,
    },
    enabled: Boolean(settings.enabled),
    acceptingApplications,
    applicationsOpenAt: settings.applicationsOpenAt
      ? settings.applicationsOpenAt.toISOString()
      : null,
    applicationsCloseAt: settings.applicationsCloseAt
      ? settings.applicationsCloseAt.toISOString()
      : null,
    intakeYear: settings.intakeYear,
    acceptedGrades: asStringArray(settings.acceptedGrades),
    admissionFeeRequired: Boolean(settings.admissionFeeRequired),
    admissionFeeAmount: decimalToString(settings.defaultAdmissionFeeAmount),
    currency: settings.currency || "ZAR",
    proofOfPaymentRequired: Boolean(settings.proofOfPaymentRequired),
    paymentVerificationRequired: Boolean(settings.paymentVerificationRequired),
    requirePaymentVerifiedBeforeAccept: Boolean(settings.requirePaymentVerifiedBeforeAccept),
    admissionContactEmail: settings.admissionContactEmail,
    admissionContactPhone: settings.admissionContactPhone,
    requiredDocuments: asJsonArray(settings.requiredDocuments),
    applicationQuestions: asJsonArray(settings.applicationQuestions),
    privacyNoticeVersion: settings.privacyNoticeVersion,
    declarationText: settings.declarationText,
  };
}

/**
 * Public config for SPA. Returns safe closed state for disabled schools that still have a slug.
 * Unknown slug → 404. Never returns bank details or internal schoolId.
 */
export async function getPublicAdmissionsConfig(
  prisma: PrismaClient,
  schoolSlug: string,
  now: Date = new Date()
): Promise<PublicAdmissionsConfig> {
  const resolved = await resolvePublicAdmissionsBySlug(prisma, schoolSlug);
  return buildPublicAdmissionsConfig({
    publicSlug: String(resolved.settings.publicSlug || schoolSlug).toLowerCase(),
    schoolName: resolved.school.name,
    logoUrl: resolved.school.logoUrl,
    primaryColor: resolved.school.primaryColor,
    settings: resolved.settings,
    now,
  });
}

export function assertCanCreatePublicApplication(
  settings: SchoolAdmissionsSettings,
  now: Date = new Date()
) {
  assertAdmissionsAcceptingApplications(settings, { now, requireEnabled: true });
}

export { PublicAdmissionsError, resolvePublicAdmissionsBySlug, isAdmissionsWindowOpen };
