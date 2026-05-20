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
  | "downloadTemplate"
  | "rollbackImport"
  | "repairClassrooms";

export type MigrationValidationReport = {
  projectId: string;
  schoolId: string;
  schoolName: string;
  source: string;
  rowCount: number;
  learnerCount: number;
  parentLinkCount: number;
  classroomGroupCount: number;
  duplicateClassrooms: Array<{
    matchKey: string;
    canonicalName: string;
    variants: string[];
    learnerRows: number;
  }>;
  duplicateLearners: Array<{
    key: string;
    label: string;
    rowIndexes: number[];
  }>;
  missingParents: Array<{ rowIndex: number; learnerLabel: string }>;
  teacherAssignmentWarnings: Array<{
    matchKey: string;
    canonicalName: string;
    teachers: Array<{ name: string; email: string; rowCount: number }>;
  }>;
  normalizationPreview: Array<{
    matchKey: string;
    originalName: string;
    canonicalName: string;
    normalizedName: string;
    rawLabels: string[];
    detectedGrade: string;
    detectedClassLetter: string;
    detectedYear: number | null;
    importYear: number | null;
    learnerCount: number;
    teacherEmail: string;
    teacherName: string;
    warnings: string[];
    needsConfirmation: boolean;
    warning?: string;
  }>;
  issues: MigrationIssueRow[];
  mappings: FieldMappingRow[];
  canImport: boolean;
  blockingErrorCount: number;
  warningCount: number;
};

export type MigrationProjectState = {
  projectId: string;
  confirmToken: string;
  report: MigrationValidationReport | null;
  stagedRows: Record<string, string>[];
  headers: string[];
};
