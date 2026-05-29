export type BillingPlanFeeLine = {
  feeDescription: string;
  amount: number;
};

export type MigrationBillingPlansPreview = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  sessionId: string;
  fileName: string;
  canApply: boolean;
  counts: {
    dbActiveLearners: number;
    billingFileLearners: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    learnersWithoutPlan: number;
    existingPlanLearners: number;
    plansToWrite: number;
  };
  rows: Array<{
    billingMatchKey: string;
    fullName: string;
    className: string;
    feeLineCount: number;
    totalAmount: number;
    learnerId: string | null;
    learnerName: string;
    strategy: string | null;
    ambiguous: boolean;
    fees: BillingPlanFeeLine[];
    status: string;
  }>;
  learnersWithoutPlan: Array<{
    learnerId: string;
    firstName: string;
    lastName: string;
    className: string | null;
    admissionNo: string | null;
    idNumber: string | null;
  }>;
  amountExamples: Array<{
    fullName: string;
    className: string;
    totalAmount: number;
    feeCount: number;
    fees: BillingPlanFeeLine[];
  }>;
};

export type MigrationBillingPlansApplyResult = {
  success: boolean;
  schoolId: string;
  learnersUpdated: number;
  fileName: string;
};

export type MigrationLearnerRepairPreview = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  sessionId: string;
  fileName: string;
  fileNames: string[];
  filesUploaded: number;
  canApply: boolean;
  counts: {
    totalRows: number;
    rawRowsParsed?: number;
    matched: number;
    ambiguous: number;
    noMatch: number;
    boysDetected: number;
    girlsDetected: number;
    updatesToApply: number;
    genderUpdates: number;
    idNumberUpdates: number;
    classUpdates: number;
    boysAfter: number;
    girlsAfter: number;
    boysBefore: number;
    girlsBefore: number;
  };
  rows: Array<{
    importKey: string;
    importedLearnerLabel: string;
    importedClass: string | null;
    matchedLearnerId: string | null;
    currentLearnerName: string;
    currentGender: string | null;
    importedGender: string | null;
    matchType: string;
    action: string;
    ambiguous: boolean;
    closestLearnerName?: string | null;
    closestSimilarityPercent?: number | null;
    noMatchReason?: string | null;
  }>;
};

export type MigrationLearnerRepairApplyResult = {
  success: boolean;
  schoolId: string;
  fileName: string;
  fileNames?: string[];
  updatedLearners: number;
  boys: number;
  girls: number;
  skipped: number;
  ambiguous: number;
};

export type MigrationToolStatus = {
  phase: "idle" | "ready" | "previewed" | "applied" | "error";
  message: string;
};
