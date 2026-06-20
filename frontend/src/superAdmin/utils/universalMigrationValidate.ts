import { superAdminApiFetch } from "../superAdminApi";
import type { MigrationFileColumnMappings } from "./buildEffectiveFileMappings";
import type { MigrationFilePreview } from "./universalMigrationPreview";

export type MigrationValidationSeverity = "error" | "warning" | "info";

export type MigrationValidationMode = "preview" | "full";

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

export type UniversalMigrationValidateResponse = {
  success: boolean;
  summary: MigrationValidationSummary;
  issues: MigrationValidationIssue[];
};

export async function fetchUniversalMigrationValidation(input: {
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  mode?: MigrationValidationMode;
  filePaths?: Record<string, string>;
  schoolId?: string;
  /** ISO date (YYYY-MM-DD) — transactions before cutover are historical-only. */
  cutoverDate?: string;
}): Promise<UniversalMigrationValidateResponse> {
  const data = (await superAdminApiFetch("/api/migration/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as UniversalMigrationValidateResponse | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : "Validation failed";
    throw new Error(message);
  }

  return data as UniversalMigrationValidateResponse;
}
