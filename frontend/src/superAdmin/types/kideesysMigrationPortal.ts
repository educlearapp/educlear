export type KideesysMigrationStep =
  | "upload"
  | "mapping"
  | "counts"
  | "classify"
  | "duplicates"
  | "balances"
  | "errors"
  | "review"
  | "approve"
  | "apply"
  | "report";

export type KideesysIssue = {
  id: string;
  issue: string;
  severity: "error" | "warning" | "info";
  record: string;
  suggestedFix: string;
  category: string;
};

export type KideesysColumnMapping = {
  slot: string;
  sourceFile: string;
  eduClearTarget: string;
  status: "mapped" | "required" | "optional";
};

export type KideesysClassification = {
  matchKey: string;
  fullName: string;
  accountNo: string;
  tier: "ACTIVE" | "HISTORICAL";
  className: string;
  ageAnalysisBalance: number;
};

export type KideesysValidationResult = {
  projectId: string;
  schoolId: string;
  confirmToken: string;
  canStage: boolean;
  canApply: boolean;
  activeLearnerCount: number;
  historicalLearnerCount: number;
  classifications: KideesysClassification[];
  columnMappings: KideesysColumnMapping[];
  issues: KideesysIssue[];
  duplicateLearners: Array<{ key: string; label: string; rowIndexes: number[] }>;
  duplicateAccounts: Array<{ accountNo: string; names: string[] }>;
  balanceValidation: {
    accountsChecked: number;
    varianceCount: number;
    maxVariance: number;
    canImportBalances: boolean;
  };
  countValidation: {
    learnersFromClassList: number;
    learnersFromContactList: number;
    learnersFromBillingPlan: number;
    billingAccountsFromAgeAnalysis: number;
    countsMatch: boolean;
    errors: string[];
  };
  summary?: {
    totalLearners: number;
    totalParents: number;
    totalClasses: number;
    totalInvoices: number;
    totalPayments: number;
    totalOutstandingBalance: number;
  };
};

export type KideesysPostImportReport = {
  projectId: string;
  schoolId: string;
  importedAt: string;
  imported: Record<string, number>;
  activeLearnersInDb: number;
  historicalLearnersInDb: number;
  balanceVarianceCount: number;
  success: boolean;
};
