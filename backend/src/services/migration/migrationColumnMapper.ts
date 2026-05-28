import {
  suggestColumnMappings,
  type SuggestColumnMappingsResult,
} from "./core/suggestColumnMappings";
import type { MigrationFilePreview } from "./types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "./types/MigrationValidation";
import type { MigrationTargetField } from "./types/MigrationTargetField";
import type {
  MigrationDataGroup,
  MigrationFieldMappingReport,
  MigrationSourceSystem,
} from "./migrationTypes";
import { sortFilesByImportPriority } from "./migrationFileDetector";

const CRITICAL_BY_GROUP: Partial<Record<MigrationDataGroup, MigrationTargetField[]>> = {
  learners: ["firstName", "lastName", "fullName"],
  parents: ["parentName"],
  accounts: ["accountNumber"],
  transaction_history: ["transactionDate", "amount"],
  invoices: ["amount", "transactionDate"],
  payments: ["amount", "transactionDate"],
};

function mappingConfidenceThreshold(): number {
  return 80;
}

export function buildColumnMappingsForPreviews(
  previews: MigrationFilePreview[],
  sourceSystem: MigrationSourceSystem,
  dataGroupsByFileId: Map<string, MigrationDataGroup>
): {
  suggestions: SuggestColumnMappingsResult[];
  effective: MigrationFileColumnMappings[];
  reports: MigrationFieldMappingReport[];
} {
  const ordered = sortFilesByImportPriority(
    previews.map((p) => ({
      preview: p,
      dataGroup: dataGroupsByFileId.get(p.fileId) ?? "unknown",
      sourceSystem,
    }))
  );

  const suggestions: SuggestColumnMappingsResult[] = [];
  const effective: MigrationFileColumnMappings[] = [];
  const reports: MigrationFieldMappingReport[] = [];

  for (const { preview, dataGroup } of ordered) {
    const category = String(preview.category || "unknown");
    const systemId =
      sourceSystem === "generic-csv" ? "generic-excel-csv" : sourceSystem;

    const suggestion = suggestColumnMappings({
      fileId: preview.fileId,
      filename: preview.filename,
      category,
      columns: preview.columns ?? [],
      systemId: systemId === "unknown" ? undefined : systemId,
    });

    suggestions.push(suggestion);

    const mapped = suggestion.mappings
      .filter((m) => m.suggestedTarget && m.confidence >= mappingConfidenceThreshold())
      .map((m) => ({
        sourceColumn: m.sourceColumn,
        targetField: m.suggestedTarget as MigrationTargetField,
      }));

    effective.push({
      fileId: preview.fileId,
      mappings: mapped,
    });

    const critical = CRITICAL_BY_GROUP[dataGroup] ?? [];
    const mappedTargets = new Set(mapped.map((m) => m.targetField));
    const missingTargets = critical.filter((t) => !mappedTargets.has(t));

    reports.push({
      fileId: preview.fileId,
      filename: preview.filename,
      dataGroup,
      mapped,
      missingTargets,
      unmappedColumns: suggestion.unmappedColumns,
    });
  }

  return { suggestions, effective, reports };
}

/** Never overwrite: only fill empty target slots from lower-priority files. */
export function mergeMappingsPreferExisting(
  primary: MigrationFileColumnMappings[],
  secondary: MigrationFileColumnMappings[]
): MigrationFileColumnMappings[] {
  const byFile = new Map(primary.map((m) => [m.fileId, { ...m, mappings: [...m.mappings] }]));
  for (const file of secondary) {
    const existing = byFile.get(file.fileId);
    if (!existing) {
      byFile.set(file.fileId, file);
      continue;
    }
    const targets = new Set(existing.mappings.map((m) => m.targetField));
    for (const m of file.mappings) {
      if (!targets.has(m.targetField)) {
        existing.mappings.push(m);
        targets.add(m.targetField);
      }
    }
  }
  return [...byFile.values()];
}
