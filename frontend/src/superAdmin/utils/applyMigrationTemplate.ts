import { MAPPED_CONFIDENCE_THRESHOLD } from "../constants/migrationTargetFields";
import type { FileMappingSuggestion } from "./universalMigrationMappings";
import type { MigrationFilePreview } from "./universalMigrationPreview";
import type { MigrationMappingTemplate, MigrationTemplateMappingRule } from "./universalMigrationTemplates";

function normalizeColumnKey(column: string): string {
  return column.trim().toLowerCase();
}

function findTemplateRule(
  column: string,
  rules: MigrationTemplateMappingRule[]
): MigrationTemplateMappingRule | undefined {
  const exact = rules.find((r) => r.sourceColumn === column);
  if (exact) return exact;
  const key = normalizeColumnKey(column);
  return rules.find((r) => normalizeColumnKey(r.sourceColumn) === key);
}

function previewColumns(preview: MigrationFilePreview): string[] {
  if (preview.columns.length > 0) return preview.columns;
  if (preview.sampleRows.length > 0) return Object.keys(preview.sampleRows[0]);
  return [];
}

/**
 * Apply template mapping rules to current uploads by source column name.
 * Unmatched upload columns keep auto-suggestions (shown as Needs review when unmapped).
 */
export function applyMigrationTemplateToSession(input: {
  previews: MigrationFilePreview[];
  template: MigrationMappingTemplate;
}): {
  overrides: Record<string, Record<string, string>>;
  appliedCount: number;
  unmatchedTemplateRules: number;
} {
  const { previews, template } = input;
  const rules = Array.isArray(template.mappings) ? template.mappings : [];
  const overrides: Record<string, Record<string, string>> = {};
  let appliedCount = 0;
  const matchedRuleKeys = new Set<string>();

  for (const preview of previews) {
    const columns = previewColumns(preview);
    if (columns.length === 0) continue;

    const fileOverrides: Record<string, string> = {};
    for (const column of columns) {
      const rule = findTemplateRule(column, rules);
      if (rule?.targetField) {
        fileOverrides[column] = rule.targetField;
        appliedCount += 1;
        matchedRuleKeys.add(normalizeColumnKey(rule.sourceColumn));
      }
    }

    if (Object.keys(fileOverrides).length > 0) {
      overrides[preview.fileId] = fileOverrides;
    }
  }

  const unmatchedTemplateRules = rules.filter(
    (r) => r.sourceColumn && !matchedRuleKeys.has(normalizeColumnKey(r.sourceColumn))
  ).length;

  return { overrides, appliedCount, unmatchedTemplateRules };
}

/** Collect effective mapping rules from suggestions + manual overrides (for save). */
export function collectMappingRulesForTemplate(
  suggestions: FileMappingSuggestion[],
  overrides: Record<string, Record<string, string>>
): MigrationTemplateMappingRule[] {
  const rules = new Map<string, string>();

  for (const suggestion of suggestions) {
    const fileOverrides = overrides[suggestion.fileId] ?? {};
    const columns =
      suggestion.mappings.length > 0
        ? suggestion.mappings.map((m) => m.sourceColumn)
        : suggestion.unmappedColumns;

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
        rules.set(sourceColumn, targetField);
      }
    }
  }

  return Array.from(rules.entries()).map(([sourceColumn, targetField]) => ({
    sourceColumn,
    targetField,
  }));
}
