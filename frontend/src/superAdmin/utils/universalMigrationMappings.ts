import { superAdminApiFetch } from "../superAdminApi";
import type { MigrationFilePreview } from "./universalMigrationPreview";

export type ColumnMappingSuggestion = {
  sourceColumn: string;
  suggestedTarget: string | null;
  confidence: number;
  reason: string;
};

export type FileMappingSuggestion = {
  fileId: string;
  filename: string;
  category: string;
  mappings: ColumnMappingSuggestion[];
  unmappedColumns: string[];
};

export type UniversalMigrationMappingSuggestResponse = {
  success: boolean;
  suggestions: FileMappingSuggestion[];
};

export async function fetchUniversalMigrationMappingSuggestions(
  previews: MigrationFilePreview[],
  systemId?: string,
  schoolId?: string
): Promise<UniversalMigrationMappingSuggestResponse> {
  const sessionSchoolId = String(schoolId || "").trim();
  const data = (await superAdminApiFetch("/api/migration/mappings/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      previews,
      ...(systemId?.trim() ? { systemId: systemId.trim() } : {}),
      ...(sessionSchoolId ? { schoolId: sessionSchoolId } : {}),
    }),
  })) as UniversalMigrationMappingSuggestResponse | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : "Mapping suggestions failed";
    throw new Error(message);
  }

  return data as UniversalMigrationMappingSuggestResponse;
}
