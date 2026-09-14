/**
 * Public admissions config + applicant draft types (OA-03B / OA-06B / OA-06C).
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

/** Applicant-facing application view from public draft APIs. */
export type ApplicantApplicationView = {
  publicAccessId: string;
  status: string;
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
};

export type CreateDraftApplicationBody = {
  intakeYear?: number | null;
  requestedGrade?: string | null;
};

export type DraftLearnerPayload = {
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
};

export type DraftGuardianPayload = {
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
};

export type UpdateDraftApplicationBody = {
  requestedGrade?: string | null;
  intakeYear?: number | null;
  learner?: DraftLearnerPayload | null;
  guardians?: DraftGuardianPayload[] | null;
  answers?: Array<{
    questionKey: string;
    questionLabelSnapshot?: string;
    valueJson?: unknown;
  }> | null;
  privacyAccepted?: boolean;
  declarationsAccepted?: boolean;
  privacyNoticeVersion?: string | null;
};

export type CreateDraftApplicationResponse = {
  success: boolean;
  application?: ApplicantApplicationView;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  error?: string;
  code?: string;
};

export type ApplicantApplicationResponse = {
  success: boolean;
  application?: ApplicantApplicationView;
  error?: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
};

export type SubmitApplicationResponse = {
  success: boolean;
  application?: ApplicantApplicationView;
  paymentInstructionsAvailable?: boolean;
  bankConfigurationIncomplete?: boolean;
  error?: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
};

export type PublicApplicationQuestion = {
  key: string;
  label: string;
  required: boolean;
};

/** Local form guardian row (clientKey is UI-only; never sent as authority). */
export type DraftGuardianFormRow = {
  clientKey: string;
  title: string;
  firstName: string;
  surname: string;
  relationship: string;
  idNumber: string;
  cellNo: string;
  email: string;
  homeAddress: string;
  employer: string;
  isPrimary: boolean;
  isPayingPerson: boolean;
};

export type DraftApplicationFormState = {
  intakeYear: number | null;
  requestedGrade: string;
  learner: {
    firstName: string;
    lastName: string;
    birthDate: string;
    gender: string;
    idNumber: string;
    previousSchoolName: string;
    homeAddress: string;
    homeLanguage: string;
    citizenship: string;
  };
  guardians: DraftGuardianFormRow[];
};

export type DraftSaveUiState = "clean" | "dirty" | "saving" | "saved" | "failed";

/** Minimal same-device resume session — bound to publicSlug. */
export type PublicApplicantSession = {
  publicSlug: string;
  publicAccessId: string;
  accessToken: string;
  accessTokenExpiresAt: string | null;
};

/** Configured admissions document requirement (from public config requiredDocuments). */
export type PublicRequiredDocumentConfig = {
  key: string;
  label: string | null;
  required: boolean;
};

/** Applicant document list item from public documents API. */
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

export type ApplicantDocumentsListResponse = {
  success: boolean;
  documents?: ApplicantDocumentView[];
  requiredDocumentTypes?: string[];
  error?: string;
  code?: string;
};

export type ApplicantDocumentUploadResponse = {
  success: boolean;
  document?: ApplicantDocumentView;
  error?: string;
  code?: string;
};

export type ApplyWizardStep = "details" | "documents" | "review";

export type PublicValidationDetail = {
  field: string;
  message: string;
};
