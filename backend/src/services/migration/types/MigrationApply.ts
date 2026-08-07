import type { MigrationStagedCounts } from "./MigrationStage";
import type { MigrationReversalReportRow } from "./MigrationReversal";
import type { MigrationApplyExpectations } from "./MigrationApplyExpectations";
import type {
  ParentIdentityPreflightReport,
  ParentIdentityResolution,
} from "../parentIdentity/parentIdentityTypes";
import type { UniversalMigrationParentReviewContract } from "../core/universalMigrationParentIdentity";

export type MigrationTransactionOutcomeCounts = {
  posted: number;
  historicalNotApplied: number;
  blocked: number;
  unmatched: number;
  duplicateSkipped: number;
};

export type MigrationApplyMode = "APPLY" | "FULL_MIGRATION_PREFLIGHT";

export type MigrationApplyRequest = {
  stageId: string;
  targetSchoolId: string;
  confirmationText: string;
  /** Super Admin override: post eligible active rows while leaving blocked/unmatched unapplied. */
  proceedWithEligibleActiveOnly?: boolean;
  /**
   * FULL_MIGRATION_PREFLIGHT: parse/validate/resolve identity only — ZERO database writes
   * and ZERO production JSON billing-store writes.
   */
  mode?: MigrationApplyMode;
  /** Alias for mode === "FULL_MIGRATION_PREFLIGHT". */
  fullMigrationPreflight?: boolean;
  /** Operator resolutions for prior REVIEW/CONFLICT parent identity itemKeys. */
  parentIdentityResolutions?: ParentIdentityResolution[];
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
  /**
   * APPLY | FULL_MIGRATION_PREFLIGHT | MIGRATION_REQUIRES_REVIEW
   * When MIGRATION_REQUIRES_REVIEW: success=false and zero school mutations occurred.
   */
  migrationStatus?:
    | "APPLIED"
    | "FULL_MIGRATION_PREFLIGHT"
    | "MIGRATION_REQUIRES_REVIEW"
    | "BLOCKED_REQUIRES_REVIEW";
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  transactionOutcomes?: MigrationTransactionOutcomeCounts;
  report: MigrationImportReportRow[];
  /** Pre-apply simulation — learner creates only from learner-category files. */
  applyExpectations?: MigrationApplyExpectations;
  /** Parent identity preflight report (always when parents are in scope). */
  parentIdentityPreflight?: ParentIdentityPreflightReport;
  /** Operator-facing review contract when unresolved parents exist. */
  parentIdentityReview?: UniversalMigrationParentReviewContract;
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
