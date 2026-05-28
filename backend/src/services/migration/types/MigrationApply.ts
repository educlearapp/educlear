import type { MigrationStagedCounts } from "./MigrationStage";
import type { MigrationReversalReportRow } from "./MigrationReversal";
import type { MigrationApplyExpectations } from "./MigrationApplyExpectations";

export type MigrationTransactionOutcomeCounts = {
  posted: number;
  historicalNotApplied: number;
  blocked: number;
  unmatched: number;
  duplicateSkipped: number;
};

export type MigrationApplyRequest = {
  stageId: string;
  targetSchoolId: string;
  confirmationText: string;
  /** Super Admin override: post eligible active rows while leaving blocked/unmatched unapplied. */
  proceedWithEligibleActiveOnly?: boolean;
};

export type MigrationImportReportRowStatus =
  | "created"
  | "skipped"
  | "failed"
  | "not_applied";

export type MigrationImportEntityType =
  | "learner"
  | "parent"
  | "employee"
  | "billingAccount"
  | "transaction"
  | "classroom"
  | "parentLearnerLink";

export type MigrationImportReportRow = {
  entityType: MigrationImportEntityType;
  sourceFileId: string;
  sourceFilename: string;
  rowNumber: number;
  status: MigrationImportReportRowStatus;
  message: string;
  key?: string;
  recordId?: string;
};

export type MigrationApplyCounts = {
  learners: number;
  parents: number;
  employees: number;
  billingAccounts: number;
  transactions: number;
  classrooms: number;
  parentLearnerLinks: number;
};

export type MigrationApplyResult = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  appliedAt: string;
  success: boolean;
  error?: string;
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  transactionOutcomes?: MigrationTransactionOutcomeCounts;
  report: MigrationImportReportRow[];
  /** Pre-apply simulation — learner creates only from learner-category files. */
  applyExpectations?: MigrationApplyExpectations;
};

export type MigrationImportBatchStatus =
  | "pending"
  | "applying"
  | "completed"
  | "failed"
  | "rolled_back";

export type MigrationRollbackReportRow = {
  entityType: MigrationImportEntityType;
  recordId: string;
  status: "deleted" | "skipped" | "blocked";
  message: string;
};

export type MigrationImportBatch = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  sourceSystem: string;
  status: MigrationImportBatchStatus;
  createdAt: string;
  completedAt?: string;
  rolledBackAt?: string;
  createdCounts?: MigrationApplyCounts;
  skippedCounts?: MigrationApplyCounts;
  failedCounts?: MigrationApplyCounts;
  reportRows?: MigrationImportReportRow[];
  rollbackReport?: MigrationRollbackReportRow[];
  reversalReport?: MigrationReversalReportRow[];
  result?: MigrationApplyResult;
  stagedCounts?: MigrationStagedCounts;
};

export type MigrationRollbackRequest = {
  batchId: string;
  targetSchoolId: string;
  confirmationText: string;
};

export type MigrationRollbackResult = {
  batchId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  rolledBackAt: string;
  success: boolean;
  deletedCounts: MigrationApplyCounts;
  blockedCounts: MigrationApplyCounts;
  report: MigrationRollbackReportRow[];
};
