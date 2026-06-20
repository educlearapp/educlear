import type { MigrationApplyExpectations } from "./MigrationApplyExpectations";
import type { PaymentReceiveListStageData } from "../core/paymentReceiveListReconciliation";
import type { MigrationFileColumnMappings } from "./MigrationValidation";
import type { MigrationValidationSummary } from "./MigrationValidation";

export type MigrationStagedCounts = {
  learners: number;
  parents: number;
  billingAccounts: number;
  transactions: number;
  staff: number;
  historical: number;
};

/** Phase 13 — transaction import readiness (dry run only; no ledger apply). */
export type MigrationTransactionReadinessCounts = {
  historicalOnlyTransactions: number;
  eligibleActiveTransactions: number;
  blockedTransactions: number;
  unmatchedTransactions: number;
};

export type MigrationStageFileSummary = {
  fileId: string;
  filename: string;
  category: string;
  rowCount: number;
  /** Absolute path under migration staging — required for apply. */
  path?: string;
};

/** Read-only dry-run package — no live school data. */
export interface MigrationStage {
  stageId: string;
  createdAt: string;
  sourceSystem: string;
  /** ISO date (YYYY-MM-DD). Transactions before this date are historical-only. */
  cutoverDate?: string;
  files: MigrationStageFileSummary[];
  mappings: MigrationFileColumnMappings[];
  validationSummary: MigrationValidationSummary;
  stagedCounts: MigrationStagedCounts;
  transactionReadiness: MigrationTransactionReadinessCounts;
  paymentReceiveList?: PaymentReceiveListStageData;
  warnings: string[];
  canApply: boolean;
  /** Populated on GET stage when targetSchoolId query is provided (read-only). */
  applyExpectations?: MigrationApplyExpectations;
}

export type MigrationStageListItem = Pick<
  MigrationStage,
  "stageId" | "createdAt" | "sourceSystem" | "stagedCounts" | "canApply"
> & {
  fileCount: number;
};
