/**
 * Universal migration pipeline — shared types for every school.
 */
import type { MigrationFileCategory } from "./types/MigrationFile";
import type { MigrationFilePreview } from "./types/MigrationFilePreview";
import type {
  MigrationFileColumnMappings,
  MigrationValidationIssue,
  MigrationValidationSummary,
} from "./types/MigrationValidation";
import type { MigrationStage } from "./types/MigrationStage";
import type { MigrationApplyResult } from "./types/MigrationApply";

/** Finer-grained content detected from headers (not only filename). */
export type MigrationDataGroup =
  | "classrooms"
  | "learners"
  | "parents"
  | "parent_learner_links"
  | "accounts"
  | "billing_plans"
  | "invoices"
  | "payments"
  | "journals"
  | "balances"
  | "transaction_history"
  | "staff"
  | "unknown";

export type MigrationSourceSystem =
  | "sasams"
  | "kideesys"
  | "generic-excel"
  | "generic-csv"
  | "unknown";

export type MigrationFileKind = "csv" | "xls" | "xlsx" | "zip" | "unknown";

export type MigrationStagedFileRecord = {
  fileId: string;
  schoolId: string;
  projectId: string;
  originalFilename: string;
  storedPath: string;
  fileKind: MigrationFileKind;
  sourceSystem: MigrationSourceSystem;
  dataGroup: MigrationDataGroup;
  category: MigrationFileCategory;
  columns: string[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  uploadedAt: string;
  sizeBytes: number;
};

export type MigrationProjectManifest = {
  projectId: string;
  schoolId: string;
  source: MigrationSourceSystem;
  createdAt: string;
  updatedAt: string;
  files: MigrationStagedFileRecord[];
  lastDryRunId?: string;
  lastDryRunPassed?: boolean;
  lastImportBatchId?: string;
};

export type MigrationFieldMappingReport = {
  fileId: string;
  filename: string;
  dataGroup: MigrationDataGroup;
  mapped: Array<{ sourceColumn: string; targetField: string }>;
  missingTargets: string[];
  unmappedColumns: string[];
};

export type MigrationValidationReport = {
  projectId: string;
  schoolId: string;
  source: MigrationSourceSystem;
  generatedAt: string;
  filesDetected: MigrationStagedFileRecord[];
  fieldMappings: MigrationFieldMappingReport[];
  validationSummary: MigrationValidationSummary;
  issues: MigrationValidationIssue[];
  counts: {
    learners: number;
    parents: number;
    parentLinks: number;
    accounts: number;
    invoices: number;
    payments: number;
    journals: number;
    transactions: number;
  };
  unmatched: {
    learners: number;
    parents: number;
    accounts: number;
  };
  duplicateWarnings: string[];
  balanceReconciliationPreview?: {
    totalOpeningBalance: number;
    fileCount: number;
  };
  canProceed: boolean;
  blockingErrors: string[];
};

export type MigrationDryRunResult = {
  projectId: string;
  schoolId: string;
  source: MigrationSourceSystem;
  dryRunId: string;
  stage: MigrationStage;
  validation: MigrationValidationReport;
  auditPath: string;
  passed: boolean;
};

export type MigrationImportResult = {
  projectId: string;
  schoolId: string;
  source: MigrationSourceSystem;
  batchId: string;
  backupPath: string;
  apply: MigrationApplyResult;
  auditPath: string;
};

export type MigrationPostImportAudit = {
  projectId: string;
  schoolId: string;
  batchId: string;
  generatedAt: string;
  applyCounts: MigrationApplyResult["createdCounts"];
  learnerCount: number;
  parentCount: number;
  familyAccountCount: number;
  ledgerEntryCount: number;
  duplicateRunSafe: boolean;
  checks: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
};

export type MigrationRollbackResult = {
  projectId: string;
  schoolId: string;
  batchId?: string;
  backupRestored: boolean;
  batchRolledBack: boolean;
  message: string;
};

export type MigrationPipelineUploadInput = {
  schoolId: string;
  projectId: string;
  source?: MigrationSourceSystem;
  filePaths: Array<{ originalFilename: string; absolutePath: string; sizeBytes: number }>;
};

export type MigrationPipelineRunInput = {
  schoolId: string;
  projectId: string;
  source: MigrationSourceSystem;
  cutoverDate?: string | null;
};

export type MigrationPipelineContext = {
  manifest: MigrationProjectManifest;
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
};

export { type MigrationFilePreview, type MigrationStage, type MigrationApplyResult };
