export type MigrationValidationSeverity = "error" | "warning" | "info";

export type MigrationValidationIssue = {
  fileId: string;
  filename: string;
  rowNumber: number;
  severity: MigrationValidationSeverity;
  category: string;
  field: string;
  message: string;
  value: string;
};

export type MigrationValidationMode = "preview" | "full";

export type MigrationValidationSummary = {
  mode: MigrationValidationMode;
  rowsChecked: number;
  totalIssues: number;
  errors: number;
  warnings: number;
  info: number;
  canProceed: boolean;
  issuesShown: number;
  issuesTruncated?: boolean;
  truncationMessage?: string;
};

export type MigrationValidationResult = {
  summary: MigrationValidationSummary;
  issues: MigrationValidationIssue[];
};

/** Per-file column → EduClear target field mappings for preview validation. */
export type MigrationFileColumnMappings = {
  fileId: string;
  mappings: Array<{ sourceColumn: string; targetField: string }>;
};
