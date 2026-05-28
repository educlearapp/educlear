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
};

export type MigrationReconciliationRequest = {
  batchId: string;
  targetSchoolId: string;
};
