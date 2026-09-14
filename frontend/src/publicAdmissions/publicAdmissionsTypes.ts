/**
 * Public admissions config types — mirrors backend PublicAdmissionsConfig (OA-03B / OA-06B).
 * Never includes bank details or internal schoolId.
 */

export type PublicAdmissionsBranding = {
  logoUrl: string | null;
  primaryColor: string | null;
};

export type PublicAdmissionsConfig = {
  publicSlug: string;
  schoolDisplayName: string;
  branding: PublicAdmissionsBranding;
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

export type PublicAdmissionsConfigResponse = {
  success: boolean;
  config?: PublicAdmissionsConfig;
  error?: string;
  code?: string;
};

export type PublicAdmissionsShellState =
  | "LOADING"
  | "OPEN"
  | "DISABLED"
  | "CLOSED_BEFORE_WINDOW"
  | "CLOSED_AFTER_WINDOW"
  | "CLOSED"
  | "NOT_FOUND"
  | "ERROR";
