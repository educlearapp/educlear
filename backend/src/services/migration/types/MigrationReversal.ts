import type { MigrationApplyCounts } from "./MigrationApply";

export type MigrationReversalRequest = {
  batchId: string;
  targetSchoolId: string;
  confirmationText: string;
};

export type MigrationReversalReportRowStatus = "reversed" | "skipped" | "failed";

export type MigrationReversalReportRow = {
  entityType: "transaction";
  recordId: string;
  status: MigrationReversalReportRowStatus;
  message: string;
  reversalRecordId?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  rowNumber?: number;
};

export type MigrationReversalResult = {
  batchId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  rolledBackAt: string;
  success: boolean;
  reversedCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  report: MigrationReversalReportRow[];
};
