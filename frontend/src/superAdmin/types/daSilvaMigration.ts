export type DaSilvaStagedUploadStatus = {
  classListFiles: number;
  learnerRegister: boolean;
  parentLearnerLinks: boolean;
  parentRegister: boolean;
  contactList: boolean;
  employeeContactList: boolean;
  billingPlan: boolean;
  ageAnalysis: boolean;
  transactions: boolean;
  manifestPath: string | null;
  manifestReady: boolean;
  manifestErrors: string[];
};

export type DaSilvaManifestDebugSlot = {
  slot: string;
  path: string | null;
  exists: boolean;
  readable: boolean;
  size: number;
  basename: string | null;
};

export type DaSilvaManifestDebugReport = {
  success: boolean;
  schoolId: string;
  projectId: string;
  manifestPath: string;
  manifestExists: boolean;
  manifestReady: boolean;
  manifestErrors: string[];
  uploadedAt: string | null;
  classListsCount: number;
  classListFilenames: string[];
  filesSavedCount: number;
  slots: DaSilvaManifestDebugSlot[];
};

export type DaSilvaUploadResponse = {
  success: boolean;
  projectId: string;
  schoolId: string;
  manifestPath: string;
  manifestWritten: boolean;
  manifestReady: boolean;
  manifestErrors: string[];
  uploads: DaSilvaStagedUploadStatus;
  classListsSaved: number;
  classListFilenames: string[];
  filesSaved: string[];
};

export type DaSilvaProjectStatus = {
  success: boolean;
  projectId: string;
  schoolId: string;
  uploads: DaSilvaStagedUploadStatus;
  phasesCompleted: string[];
  failedPhase: string | null;
};

export type DaSilvaSasamsClassesLearnersPreview = {
  success: boolean;
  passed: boolean;
  headerDetection: {
    files: Array<{
      file: string;
      headerRow: number;
      mappedColumns: Array<{ columnIndex: number; header: string; mappedAs: string }>;
      learnerCount: number;
    }>;
    totalLearners: number;
    expectedClassFiles: number;
  };
  classroomValidation: {
    passed: boolean;
    totalLearners: number;
    sourceFileCount: number;
    uniqueCanonicalCount: number;
    classrooms: Array<{ canonicalName: string; learnerCount: number; sourceFile: string }>;
    errors: string[];
  };
  learnerParseAudit: {
    classListParsed: number;
    registerParsed: number;
    mergedTotal: number;
    enrichedFromRegister: number;
    missingDob: number;
    missingGender: number;
    missingId: number;
    perClassroomCounts: Array<{ classroomName: string; count: number }>;
  };
  learnersPerClass: Array<{ classroomName: string; count: number }>;
  sasamsClassListLearners?: number;
  expectedSasamsLearners?: number;
  crecheSupplementExpected?: number;
  finalLearnersExpected?: number;
  classListFilesFound?: string[];
  debug?: {
    classListFilesFound: number;
    learnersParsedPerClass: Array<{ classroomName: string; count: number }>;
    missingDob: number;
    missingId: number;
    missingGender: number;
  };
  totalLearners: number;
  missingId: number;
  missingDob: number;
  missingGender: number;
  errors: string[];
};

export type DaSilvaSasamsParentsLinksPreview = {
  success: boolean;
  passed: boolean;
  parentRegisterRows: number;
  parentLinksRows: number;
  combinedParentRows: number;
  matchedLinks: number;
  unmatchedParents: number;
  duplicateMatches: number;
  expectedParentLinks: number;
  sampleUnmatched: Array<{
    parentFirstName: string;
    parentSurname: string;
    learnerName: string | null;
    learnerAdmissionNo?: string | null;
    learnerClassName?: string | null;
  }>;
  debug?: {
    parentLinkRowsParsed: number;
    parentRegisterRowsParsed: number;
    parentLinksMatched: number;
    parentLinksUnmatched: number;
    sampleUnmatched: DaSilvaSasamsParentsLinksPreview["sampleUnmatched"];
  };
  errors: string[];
};

export type DaSilvaKideesysBillingMatchPreview = {
  success: boolean;
  passed: boolean;
  totalAccounts: number;
  matchedAccounts: number;
  unmatchedAccounts: number;
  matchRatio: number;
  minRatioRequired: number;
  maxUnmatchedAllowed: number;
  sampleUnmatched: Array<{ accountNo: string; fullName: string }>;
  debug?: {
    billingAccountsParsed: number;
    billingAccountsMatched: number;
    billingAccountsUnmatched: number;
    sampleUnmatched: Array<{ accountNo: string; fullName: string }>;
  };
  errors: string[];
};

export type DaSilvaBillingImportPreview = {
  success: boolean;
  passed: boolean;
  stagingValidation: {
    passed: boolean;
    expectedBillingAccounts: number;
    actualBillingAccounts: number;
    learnersWithBillingPlan: number;
    uniqueFeeDescriptions: number;
    ageAnalysisTotalOutstanding: number;
    errors: string[];
  };
  transactionRowCount: number;
  transactionParseErrors: string[];
  errors: string[];
};

export type DaSilvaFileSlots = {
  classListFiles: File[];
  learnerRegister: File | null;
  parentLearnerLinks: File | null;
  parentRegister: File | null;
  billingPlan: File | null;
  ageAnalysis: File | null;
  transactions: File | null;
  contactList: File | null;
  employeeContactList: File | null;
};

export type DaSilvaWizardPreviews = {
  sasamsClassesLearners: DaSilvaSasamsClassesLearnersPreview | null;
  sasamsParentsLinks: DaSilvaSasamsParentsLinksPreview | null;
  kideesysBillingMatch: DaSilvaKideesysBillingMatchPreview | null;
  billingImport: DaSilvaBillingImportPreview | null;
};

export type DaSilvaSavedFilesAuditRow = {
  slot: string;
  label: string;
  filename: string | null;
  path: string | null;
  ok: boolean;
};
