import { superAdminApiFetch } from "../superAdminApi";
import type { UniversalMigrationUploadedFile } from "./universalMigrationUpload";

export type MigrationFilePreview = {
  fileId: string;
  filename: string;
  category: string;
  columns: string[];
  sampleRows: Record<string, unknown>[];
  rowCount: number;
  warnings: string[];
  path?: string;
};

export type UniversalMigrationPreviewResponse = {
  success: boolean;
  previews: MigrationFilePreview[];
};

export async function fetchUniversalMigrationPreviews(
  files: UniversalMigrationUploadedFile[],
  sourceSystem?: string,
  schoolId?: string
): Promise<UniversalMigrationPreviewResponse> {
  const system = String(sourceSystem || "").trim();
  const sessionSchoolId = String(schoolId || "").trim();
  const data = (await superAdminApiFetch("/api/migration/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      ...(system ? { sourceSystem: system } : {}),
      ...(sessionSchoolId ? { schoolId: sessionSchoolId } : {}),
    }),
  })) as UniversalMigrationPreviewResponse | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : "Preview failed";
    throw new Error(message);
  }

  return data as UniversalMigrationPreviewResponse;
}
