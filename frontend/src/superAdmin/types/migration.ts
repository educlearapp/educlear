export type MigrationSource =
  | "sasams"
  | "kideesys"
  | "excel"
  | "csv"
  | "manual";

export type MigrationSummary = {
  projects: number;
  inProgress: number;
  completed: number;
  needsReview: number;
};

export type SchoolOption = {
  id: string;
  name: string;
};

export type DataCategoryId =
  | "learners"
  | "parents"
  | "parentRelationships"
  | "classes"
  | "schoolFeesAccounts"
  | "openingBalances"
  | "invoices"
  | "payments"
  | "staff"
  | "subjects";

export type DataCategory = {
  id: DataCategoryId;
  label: string;
};

export type UploadedMigrationFile = {
  id: string;
  name: string;
  size: number;
  type: string;
};

export type FieldMappingRow = {
  id: string;
  sourceField: string;
  eduClearField: string;
  status: string;
  notes: string;
};

export type MigrationIssueRow = {
  id: string;
  issue: string;
  severity: string;
  record: string;
  suggestedFix: string;
  status: string;
};

export type MigrationActionId =
  | "createProject"
  | "validateFiles"
  | "importStaging"
  | "finalImport"
  | "downloadTemplate";
