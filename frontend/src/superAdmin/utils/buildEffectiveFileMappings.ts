import { MAPPED_CONFIDENCE_THRESHOLD } from "../constants/migrationTargetFields";
import type { FileMappingSuggestion } from "./universalMigrationMappings";

export type MigrationFileColumnMappings = {
  fileId: string;
  mappings: Array<{ sourceColumn: string; targetField: string }>;
};

/** Effective source → target mappings from suggestions and manual overrides. */
export function buildEffectiveFileMappings(
  suggestions: FileMappingSuggestion[],
  overrides: Record<string, Record<string, string>>
): MigrationFileColumnMappings[] {
  return suggestions.map((suggestion) => {
    const fileOverrides = overrides[suggestion.fileId] ?? {};
    const columns =
      suggestion.mappings.length > 0
        ? suggestion.mappings.map((m) => m.sourceColumn)
        : suggestion.unmappedColumns;

    const mappings: Array<{ sourceColumn: string; targetField: string }> = [];

    for (const sourceColumn of columns) {
      const row = suggestion.mappings.find((m) => m.sourceColumn === sourceColumn);
      const manual = fileOverrides[sourceColumn];
      const auto =
        row &&
        row.suggestedTarget &&
        row.confidence >= MAPPED_CONFIDENCE_THRESHOLD
          ? row.suggestedTarget
          : "";
      const targetField = (manual || auto || "").trim();
      if (targetField) {
        mappings.push({ sourceColumn, targetField });
      }
    }

    return { fileId: suggestion.fileId, mappings };
  });
}

export function hasSelectedMappings(mappings: MigrationFileColumnMappings[]): boolean {
  return mappings.some((f) => f.mappings.length > 0);
}
