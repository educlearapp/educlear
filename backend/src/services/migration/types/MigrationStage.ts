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
  /**
   * Authoritative migration-run id for this dry run.
   * Equals stageId for Universal Migration (stage IS the run after staging).
   */
  migrationRunId: string;
  createdAt: string;
  sourceSystem: string;
  /**
   * Immutable target school for this migration run.
   * Selected at stage creation; apply/preflight/audit must use this school only.
   */
  targetSchoolId: string;
  /** Display snapshot of school name at stage creation (not authoritative for writes). */
  targetSchoolName: string;
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
  /** Populated on GET stage when expectations are computed (bound school only). */
  applyExpectations?: MigrationApplyExpectations;
  /**
   * Phase 1F — authoritative Source Analysis binding.
   * When set, stage mappings must come from the compiled plan for this analysis.
   */
  sourceAnalysisId?: string | null;
  analysisVersion?: string | null;
  compiledPlanId?: string | null;
  compiledPlanVersion?: string | null;
  /** Header fingerprints captured at compile/stage time for stale detection. */
  sourceFingerprints?: Array<{
    fileId: string;
    filename: string;
    headerFingerprint: string;
  }>;
}

export type MigrationStageListItem = Pick<
  MigrationStage,
  | "stageId"
  | "migrationRunId"
  | "createdAt"
  | "sourceSystem"
  | "targetSchoolId"
  | "targetSchoolName"
  | "stagedCounts"
  | "canApply"
> & {
  fileCount: number;
};
