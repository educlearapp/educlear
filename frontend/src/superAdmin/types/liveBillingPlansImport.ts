export type BillingPlanFeeLine = {
  feeDescription: string;
  amount: number;
};

export type LiveBillingPlansPreview = {
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
  matched: Array<{
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
  }>;
  unmatched: Array<{
    billingMatchKey: string;
    fullName: string;
    className: string;
    feeLineCount: number;
    totalAmount: number;
    learnerId: string | null;
    strategy: string | null;
    ambiguous: boolean;
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

export type LiveBillingPlansApplyResult = {
  success: boolean;
  schoolId: string;
  learnersUpdated: number;
  fileName: string;
};
