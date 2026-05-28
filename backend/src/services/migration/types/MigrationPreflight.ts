export type MigrationPreflightStatus = "ready" | "warning" | "blocked" | "unknown";

export type MigrationPreflightBlockerSeverity = "critical" | "warning" | "info";

export type MigrationPreflightBlocker = {
  blockerId: string;
  title: string;
  severity: MigrationPreflightBlockerSeverity;
  message: string;
};

export type MigrationPreflightSummary = {
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  overallStatus: MigrationPreflightStatus;
  runbookStatus: string;
  pilotStatus: string;
  validationStatus: string;
  dryRunStatus: string;
  batchStatus: string;
  reconciliationStatus: string;
  signoffStatus: string;
  blockers: MigrationPreflightBlocker[];
  goLiveReady: boolean;
  generatedAt: string;
  runbookId?: string;
  pilotId?: string;
  stageId?: string;
  batchId?: string;
  signoffId?: string;
};
