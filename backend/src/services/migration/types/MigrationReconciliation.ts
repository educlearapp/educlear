import type { MigrationImportBatchStatus } from "./MigrationApply";

export type MigrationReconciliationStatus = "pass" | "warning" | "fail";

export type MigrationReconciliationCheck = {
  id: string;
  check: string;
  expected: string;
  actual: string;
  status: MigrationReconciliationStatus;
  message: string;
};

export type MigrationReconciliationSummary = {
  passed: number;
  warnings: number;
  failed: number;
  total: number;
};

export type MigrationReconciliationAccountBalanceImpact = {
  migrationPostedNet: number;
  migrationPostedCount: number;
  reversalNet?: number;
  reversalCount?: number;
  note: string;
};

export type MigrationParentReconciliationMatchSignal =
  | "same_cellphone"
  | "same_email"
  | "same_relationship"
  | "similar_names";

export type MigrationParentReconciliationParent = {
  parentId: string;
  name: string;
  relationship: string | null;
  cellphone: string | null;
  email: string | null;
  learnerNames: string[];
};

export type MigrationParentReconciliationSuggestion = {
  suggestionId: string;
  status: "suggested";
  confidence: "high" | "medium";
  matchSignals: MigrationParentReconciliationMatchSignal[];
  primaryParent: MigrationParentReconciliationParent;
  duplicateParent: MigrationParentReconciliationParent;
  action: "review_merge_or_ignore";
  note: string;
};

export type MigrationParentReconciliationSummary = {
  totalSuggestedMerges: number;
  suggestions: MigrationParentReconciliationSuggestion[];
  note: string;
};

export type MigrationReconciliationResult = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  batchStatus: MigrationImportBatchStatus;
  reconciledAt: string;
  overallStatus: MigrationReconciliationStatus;
  summary: MigrationReconciliationSummary;
  checks: MigrationReconciliationCheck[];
  accountBalanceImpact?: MigrationReconciliationAccountBalanceImpact;
  parentReconciliation?: MigrationParentReconciliationSummary;
};

export type MigrationReconciliationRequest = {
  batchId: string;
  targetSchoolId: string;
};
