import type { MigrationApplyCounts, MigrationImportBatchStatus } from "./MigrationApply";
import type { MigrationReconciliationStatus } from "./MigrationReconciliation";

export type MigrationSignoffStatus = "draft" | "approved" | "blocked";

export type MigrationSignoffCounts = {
  created: MigrationApplyCounts;
  skipped: MigrationApplyCounts;
  failed: MigrationApplyCounts;
};

export type MigrationExportedReport = {
  label: string;
  filename: string;
  downloadPath: string;
};

export type MigrationSignoffPack = {
  signoffId: string;
  batchId: string;
  stageId: string;
  schoolId: string;
  schoolName: string;
  operatorName: string;
  operatorEmail: string;
  createdAt: string;
  signoffStatus: MigrationSignoffStatus;
  reconciliationStatus: MigrationReconciliationStatus;
  migrationStatus: MigrationImportBatchStatus;
  counts: MigrationSignoffCounts;
  warnings: string[];
  exportedReports: MigrationExportedReport[];
  notes: string;
  approvedForGoLive: boolean;
  approvalConfirmed: boolean;
  reconciledAt: string;
};

export type MigrationSignoffBuildInput = {
  batchId: string;
  targetSchoolId: string;
  operatorName: string;
  operatorEmail: string;
  notes?: string;
  approvalConfirmed: boolean;
};
