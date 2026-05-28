import type { MigrationReconciliationStatus } from "./MigrationReconciliation";
import type { MigrationValidationSummary } from "./MigrationValidation";

export type MigrationPilotStatus =
  | "draft"
  | "validating"
  | "passed"
  | "warning"
  | "failed";

export type MigrationPilotUploadedFile = {
  fileId: string;
  filename: string;
  category: string;
  sizeBytes?: number;
};

export type MigrationPilotValidationSummary = MigrationValidationSummary & {
  capturedAt: string;
  stageId?: string;
};

export type MigrationPilotDryRunSummary = {
  stageId?: string;
  stageCreated: boolean;
  sourceSystem: string;
  canApply: boolean;
  validationErrors: number;
  validationWarnings: number;
  stagedCounts: {
    learners: number;
    parents: number;
    billingAccounts: number;
    transactions: number;
    staff: number;
    historical: number;
  };
  transactionReadiness: {
    historicalOnlyTransactions: number;
    eligibleActiveTransactions: number;
    blockedTransactions: number;
    unmatchedTransactions: number;
  };
  dryRunWarnings: string[];
  headCountProtected: boolean;
  historicalLearnersProtected: boolean;
};

export type MigrationPilotReconciliationSummary = {
  run: boolean;
  batchId?: string;
  stageId?: string;
  overallStatus?: MigrationReconciliationStatus;
  passed: number;
  warnings: number;
  failed: number;
  total: number;
  headCountProtected: boolean;
  historicalLearnersProtected: boolean;
  reconciledAt?: string;
  messages: string[];
};

export type MigrationPilotRun = {
  pilotId: string;
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  createdAt: string;
  status: MigrationPilotStatus;
  uploadedFiles: MigrationPilotUploadedFile[];
  validationSummary: MigrationPilotValidationSummary;
  dryRunSummary: MigrationPilotDryRunSummary;
  reconciliationSummary: MigrationPilotReconciliationSummary;
  notes: string;
};

export type MigrationPilotBuildInput = {
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  uploadedFiles: MigrationPilotUploadedFile[];
  notes?: string;
  /** Hydrate validation/dry-run from staged package (read-only). */
  stageId?: string;
  /** Hydrate reconciliation from import batch (read-only). */
  batchId?: string;
  validationSummary?: Partial<MigrationPilotValidationSummary>;
  dryRunSummary?: Partial<MigrationPilotDryRunSummary>;
  reconciliationSummary?: Partial<MigrationPilotReconciliationSummary>;
};

export type MigrationPilotVerificationCheckKey =
  | "uploadSuccessful"
  | "mappingReviewed"
  | "fullValidationCompleted"
  | "dryRunReviewed"
  | "historicalLearnersProtected"
  | "headCountProtected"
  | "transactionReadinessReviewed"
  | "reconciliationCompleted"
  | "signoffGenerated";

export type MigrationPilotVerificationCheck = {
  key: MigrationPilotVerificationCheckKey;
  label: string;
  advisory: boolean;
  satisfied: boolean;
  hint?: string;
};

export type MigrationPilotBuildResult = {
  status: MigrationPilotStatus;
  validationSummary: MigrationPilotValidationSummary;
  dryRunSummary: MigrationPilotDryRunSummary;
  reconciliationSummary: MigrationPilotReconciliationSummary;
  verificationChecks: MigrationPilotVerificationCheck[];
  statusReasons: string[];
};
