/** Lean frontend mirrors of backend staff admissions + conversion types (OA-04C). */

export type PromotedLearnerSummary = {
  id: string;
  firstName: string;
  lastName: string;
  admissionNo: string | null;
  grade: string;
  className?: string | null;
};

export type PostEnrolmentSummary = {
  learner: {
    id: string;
    firstName: string;
    lastName: string;
    admissionNo: string | null;
    grade: string;
    className: string | null;
    enrollmentStatus: string;
  };
  family: {
    id: string;
    accountRef: string;
    accountNo: string;
    familyName: string;
    mode: "created" | "reused" | "unknown";
  } | null;
  placement: {
    status: "COMPLETE" | "ACTION_RECOMMENDED";
    label: string;
    grade: string;
    className: string | null;
  };
  billingPlan: {
    status: "ASSIGNED" | "REQUIRED";
    label: string;
    lineCount: number;
  };
  finance: {
    status: "READY" | "BASELINE_MISSING" | "ACCOUNT_MISSING";
    label: string;
    accountRef: string | null;
    baselinePresent: boolean | null;
    note: string;
  };
  guardians: Array<{
    parentId: string;
    firstName: string;
    surname: string;
    relationship: string | null;
    isPrimary: boolean;
    isPayingPerson: boolean;
    hasEmail: boolean;
    hasCellNo: boolean;
    portalStatus: "READY" | "ONBOARDING_REQUIRED" | "CONTACT_REQUIRED";
    portalLabel: string;
    onboardingStatus: string | null;
  }>;
  invoicing: {
    status: "WAITING_FOR_BILLING_PLAN" | "READY_FOR_FUTURE_INVOICE_RUN";
    label: string;
    note: string;
  };
  admissionFee: {
    required: boolean;
    paymentStatus: string | null;
    label: string;
    note: string;
  };
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

export type DocumentCompleteness = {
  requiredDocumentTypes: string[];
  uploadedDocumentTypes: string[];
  missingDocumentTypes: string[];
  documentsComplete: boolean;
};

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
  postEnrolment: PostEnrolmentSummary | null;
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

export type ListStaffApplicationsQuery = {
  status?: string;
  paymentStatus?: string;
  requestedGrade?: string;
  intakeYear?: number;
  q?: string;
  submittedFrom?: string;
  submittedTo?: string;
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

export type FamilyDecisionMode = "CREATE_NEW" | "USE_EXISTING";
export type GuardianDecisionMode = "CREATE_NEW" | "LINK_EXISTING";

export type ConversionDecisionDto = {
  family: {
    mode: FamilyDecisionMode;
    existingFamilyAccountId?: string;
    acknowledgeCreateNewFamilyDespiteSiblingDeclaration?: boolean;
  };
  guardians: Array<{
    admissionGuardianId: string;
    mode: GuardianDecisionMode;
    existingParentId?: string;
    confirmCreateDespiteMatch?: boolean;
  }>;
  placement: {
    grade: string;
    className?: string | null;
  };
};

export type ConversionPreflight = {
  application: {
    id: string;
    applicationNumber: string | null;
    status: string;
    alreadyConverted: boolean;
    promotedLearnerId: string | null;
    promotedFamilyAccountId: string | null;
    intakeYear: number;
    requestedGrade: string | null;
  };
  learner: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    birthDate: string | null;
    gender: string | null;
    hasIdNumber: boolean;
    homeLanguage: string | null;
    citizenship: string | null;
    requestedGrade: string | null;
    intakeYear: number;
    duplicate: null | {
      strength: "STRONG";
      matchReason: string;
      enrollmentStatus: string;
      learnerId: string;
      admissionNo: string | null;
      familyAccountId: string | null;
      accountRef: string | null;
      blockerCode: string;
    };
  };
  guardians: Array<{
    admissionGuardianId: string;
    firstName: string;
    surname: string;
    relationship: string | null;
    hasIdNumber: boolean;
    hasEmail: boolean;
    hasCellNo: boolean;
    isPrimary: boolean;
    isPayingPerson: boolean;
    identityDecision: string | null;
    matchStrength: "STRONG" | "PROBABLE" | "AMBIGUOUS" | "NONE";
    candidates: Array<{
      parentId: string;
      firstName: string;
      surname: string;
      maskedIdNumber: string;
      maskedCellphone: string;
      maskedEmail: string;
      matchReasons: string[];
      familyAccountId: string | null;
    }>;
    suggestedMode: GuardianDecisionMode | null;
    suggestedExistingParentId: string | null;
  }>;
  family: {
    declaredExistingSibling: boolean;
    declaredExistingFamily: boolean;
    declaredSiblingLearnerName: string | null;
    declaredSiblingAdmissionNo: string | null;
    staffMatchedFamilyAccountId: string | null;
    staffMatchDecision: string | null;
    candidates: Array<{
      familyAccountId: string;
      accountRef: string;
      familyName: string;
      reason: string;
      strength: "STRONG" | "PROBABLE";
    }>;
    requiresFamilyDecision: boolean;
    requiresAckForCreateNewDespiteSiblingDeclaration: boolean;
  };
  placement: {
    requestedGrade: string | null;
    proposedGrade: string | null;
    classNameRequired: false;
  };
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  canConvert: boolean;
};

export type ConversionResult = {
  action: "convert_to_learner";
  idempotent: boolean;
  learnerId: string;
  familyAccountId: string;
  admissionNo: string | null;
  accountRef: string | null;
  familyMode: "created" | "reused";
  guardianOutcomes: Array<{
    admissionGuardianId: string;
    mode: "created" | "linked";
    parentId: string;
  }>;
  grade: string;
  className: string | null;
  financeBaselineRegistered: boolean;
  financeBaselineWarning?: "FINANCE_BASELINE_SYNC_FAILED";
};

export class StaffAdmissionsApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "StaffAdmissionsApiError";
    this.code = code;
  }
}


/** OA-05B — historical learner reactivation */
export type ReactivationFamilyMode = "KEEP_EXISTING" | "USE_EXISTING";

export type ReactivationDecisionDto = {
  learnerId: string;
  family: {
    mode: ReactivationFamilyMode;
    familyAccountId?: string;
    acknowledgeHistoricalFamilyChange?: boolean;
  };
  guardians: Array<{
    admissionGuardianId: string;
    mode: GuardianDecisionMode;
    existingParentId?: string;
    confirmCreateDespiteMatch?: boolean;
  }>;
  placement: {
    grade: string;
    className?: string | null;
  };
  acknowledgeExistingBillingPlan?: boolean;
};

export type ReactivationPreflight = {
  application: {
    id: string;
    applicationNumber: string | null;
    status: string;
    alreadyEnrolled: boolean;
    promotedLearnerId: string | null;
    promotedFamilyAccountId: string | null;
    intakeYear: number;
    requestedGrade: string | null;
  };
  historicalLearner: null | {
    id: string;
    firstName: string;
    lastName: string;
    admissionNo: string | null;
    birthDate: string | null;
    historicalGrade: string;
    historicalClassName: string | null;
    enrollmentStatus: string;
  };
  match: null | {
    strength: "STRONG";
    matchReason: "idNumber" | "name+dob";
    caution: "EXACT_ID" | "NAME_DOB";
  };
  currentFamily: null | {
    familyAccountId: string;
    accountRef: string;
    accountNo: string | null;
    familyName: string;
  };
  finance: {
    balanceRand: number | null;
    balanceStatus: "POSITIVE" | "ZERO" | "CREDIT" | "UNKNOWN";
    warningCode: string | null;
    warningMessage: string | null;
  };
  billingPlan: {
    lineCount: number;
    summary: string[];
    warningCode: string | null;
    warningMessage: string | null;
    requiresAcknowledgeExistingBillingPlan: boolean;
  };
  existingParentLinks: Array<{
    parentId: string;
    firstName: string;
    surname: string;
    relationship: string | null;
    isPrimary: boolean;
    isPayingPerson: boolean;
  }>;
  preserveExistingParentLinksWarning: { code: string; message: string };
  guardians: Array<{
    admissionGuardianId: string;
    firstName: string;
    surname: string;
    relationship: string | null;
    hasIdNumber: boolean;
    hasEmail: boolean;
    hasCellNo: boolean;
    isPrimary: boolean;
    isPayingPerson: boolean;
    identityDecision: string | null;
    matchStrength: "STRONG" | "PROBABLE" | "AMBIGUOUS" | "NONE";
    candidates: Array<{
      parentId: string;
      firstName: string;
      surname: string;
      maskedIdNumber: string;
      maskedCellphone: string;
      maskedEmail: string;
      matchReasons: string[];
      familyAccountId: string | null;
    }>;
    suggestedMode: GuardianDecisionMode | null;
    suggestedExistingParentId: string | null;
    alreadyLinkedToLearner: boolean;
  }>;
  family: {
    defaultMode: ReactivationFamilyMode | null;
    allowedModes: ReactivationFamilyMode[];
    createNewSupported: false;
    candidates: Array<{
      familyAccountId: string;
      accountRef: string;
      familyName: string;
      reason: string;
      strength: "STRONG" | "PROBABLE";
      isCurrent: boolean;
    }>;
    requiresAcknowledgeHistoricalFamilyChange: boolean;
  };
  placement: {
    historicalGrade: string | null;
    historicalClassName: string | null;
    requestedGrade: string | null;
    proposedGrade: string | null;
    classNameRequired: false;
    mustConfirmGrade: true;
  };
  identityWarnings: Array<{ code: string; message: string }>;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  canReactivate: boolean;
};

export type ReactivationResult = {
  action: "reactivate_historical_learner";
  idempotent: boolean;
  learnerId: string;
  familyAccountId: string;
  admissionNo: string | null;
  accountRef: string | null;
  familyMode: "kept" | "switched";
  guardianOutcomes: Array<{
    admissionGuardianId: string;
    mode: "created" | "linked" | "already_linked";
    parentId: string;
  }>;
  grade: string;
  className: string | null;
  financeBaselineRegistered: boolean;
  financeBaselineWarning?: "FINANCE_BASELINE_SYNC_FAILED";
};
