import { superAdminApiFetch } from "../superAdminApi";
import type { FileMappingSuggestion } from "./universalMigrationMappings";
import type { MigrationFilePreview } from "./universalMigrationPreview";
import type { MigrationStage } from "./universalMigrationStage";
import type { UniversalMigrationUploadedFile } from "./universalMigrationUpload";
import type {
  MigrationValidationIssue,
  MigrationValidationMode,
  MigrationValidationSummary,
} from "./universalMigrationValidate";

export type PersistentUniversalMigrationSession = {
  schoolId: string;
  createdAt: string;
  updatedAt: string;
  sourceSystem: string;
  uploadedFiles: UniversalMigrationUploadedFile[];
  previews: MigrationFilePreview[];
  mappingSuggestions: FileMappingSuggestion[];
  mappingOverrides: Record<string, Record<string, string>>;
  validationSummary: MigrationValidationSummary | null;
  validationIssues: MigrationValidationIssue[];
  validationMode: MigrationValidationMode;
  cutoverDate: string;
  dryRunStage: MigrationStage | null;
};

export type PersistentUniversalMigrationSessionPatch = Partial<
  Omit<PersistentUniversalMigrationSession, "schoolId" | "createdAt" | "updatedAt">
>;

export async function fetchUniversalMigrationSession(
  schoolId: string
): Promise<PersistentUniversalMigrationSession | null> {
  const data = (await superAdminApiFetch(
    `/api/migration/sessions/${encodeURIComponent(schoolId)}`
  )) as { success?: boolean; session?: PersistentUniversalMigrationSession | null; error?: string };

  if (!data?.success) {
    throw new Error(data?.error || "Failed to load migration session");
  }

  return data.session ?? null;
}

export async function saveUniversalMigrationSession(
  schoolId: string,
  patch: PersistentUniversalMigrationSessionPatch
): Promise<PersistentUniversalMigrationSession> {
  const data = (await superAdminApiFetch(
    `/api/migration/sessions/${encodeURIComponent(schoolId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  )) as { success?: boolean; session?: PersistentUniversalMigrationSession; error?: string };

  if (!data?.success || !data.session) {
    throw new Error(data?.error || "Failed to save migration session");
  }

  return data.session;
}

export async function clearUniversalMigrationSession(schoolId: string): Promise<void> {
  const data = (await superAdminApiFetch(
    `/api/migration/sessions/${encodeURIComponent(schoolId)}`,
    { method: "DELETE" }
  )) as { success?: boolean; error?: string };

  if (!data?.success) {
    throw new Error(data?.error || "Failed to clear migration session");
  }
}
