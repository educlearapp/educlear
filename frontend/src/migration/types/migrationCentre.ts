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
  canApply: boolean;
  counts: {
    sourceRows: number;
    matched: number;
    unmatched: number;
    genderFixes: number;
    classroomFixes: number;
    idFixes: number;
    boysAfter: number;
    girlsAfter: number;
    boysBefore: number;
    girlsBefore: number;
  };
  rows: Array<{
    importKey: string;
    learnerLabel: string;
    matchedLearnerId: string | null;
    matchedLearnerName: string;
    currentGender: string | null;
    importedGender: string | null;
    currentClassroom: string | null;
    importedClassroom: string | null;
    currentIdNumber: string | null;
    importedIdNumber: string | null;
    status: string;
    willUpdateGender: boolean;
    willUpdateClassroom: boolean;
    willUpdateIdNumber: boolean;
  }>;
  unmatched: Array<{ importKey: string; learnerLabel: string }>;
};

export type MigrationLearnerRepairApplyResult = {
  success: boolean;
  schoolId: string;
  learnersUpdated: number;
  fileName: string;
};

export type MigrationToolStatus = {
  phase: "idle" | "ready" | "previewed" | "applied" | "error";
  message: string;
};
