import { useMemo } from "react";
import {
  ALL_MIGRATION_TARGET_FIELDS,
  MAPPED_CONFIDENCE_THRESHOLD,
  MIGRATION_TARGET_FIELD_GROUPS,
  MIGRATION_TARGET_FIELD_LABELS,
  type MigrationTargetField,
} from "../../superAdmin/constants/migrationTargetFields";
import type { FileMappingSuggestion } from "../../superAdmin/utils/universalMigrationMappings";

type MappingOverrides = Record<string, string>;

type Props = {
  suggestion: FileMappingSuggestion;
  overrides: MappingOverrides;
  onOverrideChange: (sourceColumn: string, target: string) => void;
};

function effectiveTarget(
  row: FileMappingSuggestion["mappings"][number],
  overrides: MappingOverrides
): string {
  if (row.sourceColumn in overrides) {
    return overrides[row.sourceColumn];
  }
  return row.suggestedTarget ?? "";
}

function isMapped(
  row: FileMappingSuggestion["mappings"][number],
  overrides: MappingOverrides
): boolean {
  const target = effectiveTarget(row, overrides);
  if (!target) return false;
  if (row.sourceColumn in overrides) return true;
  return row.confidence >= MAPPED_CONFIDENCE_THRESHOLD && !!row.suggestedTarget;
}

export default function UniversalMigrationMappingSuggestions({
  suggestion,
  overrides,
  onOverrideChange,
}: Props) {
  const rows = useMemo(() => {
    const columns =
      suggestion.mappings.length > 0
        ? suggestion.mappings.map((m) => m.sourceColumn)
        : suggestion.unmappedColumns;
    if (columns.length === 0) return [];
    const byColumn = new Map(suggestion.mappings.map((m) => [m.sourceColumn, m]));
    return columns.map((sourceColumn) => {
      const existing = byColumn.get(sourceColumn);
      return (
        existing ?? {
          sourceColumn,
          suggestedTarget: null,
          confidence: 0,
          reason: "No confident keyword match for this column",
        }
      );
    });
  }, [suggestion]);

  if (rows.length === 0) return null;

  return (
    <section
      className="uc-migration-mapping-section"
      aria-labelledby={`uc-mapping-${suggestion.fileId}`}
    >
      <h5 id={`uc-mapping-${suggestion.fileId}`} className="uc-migration-mapping-title">
        Mapping suggestions
      </h5>
      <p className="uc-migration-mapping-hint">
        Automatic keyword matches into EduClear standard fields. Adjust targets below — not saved
        yet.
      </p>
      <div className="uc-migration-mapping-table-wrap">
        <table className="uc-migration-mapping-table">
          <thead>
            <tr>
              <th scope="col">Source column</th>
              <th scope="col">EduClear field</th>
              <th scope="col">Confidence</th>
              <th scope="col">Reason</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mapped = isMapped(row, overrides);
              const target = effectiveTarget(row, overrides);

              return (
                <tr
                  key={row.sourceColumn}
                  className={
                    mapped
                      ? "uc-migration-mapping-row"
                      : "uc-migration-mapping-row uc-migration-mapping-row--review"
                  }
                >
                  <td className="uc-migration-mapping-col-source">{row.sourceColumn}</td>
                  <td className="uc-migration-mapping-col-target">
                    <select
                      className="uc-migration-mapping-select"
                      value={target}
                      aria-label={`Map ${row.sourceColumn} to EduClear field`}
                      onChange={(e) => onOverrideChange(row.sourceColumn, e.target.value)}
                    >
                      <option value="">— Not mapped —</option>
                      {MIGRATION_TARGET_FIELD_GROUPS.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.fields.map((field) => (
                            <option key={field} value={field}>
                              {MIGRATION_TARGET_FIELD_LABELS[field]}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {!target && row.suggestedTarget ? (
                      <span className="uc-migration-mapping-suggested-hint">
                        Suggested:{" "}
                        {MIGRATION_TARGET_FIELD_LABELS[
                          row.suggestedTarget as MigrationTargetField
                        ] ?? row.suggestedTarget}
                      </span>
                    ) : null}
                    {target && target !== row.suggestedTarget && row.suggestedTarget ? (
                      <span className="uc-migration-mapping-override-hint">Manual override</span>
                    ) : null}
                  </td>
                  <td className="uc-migration-mapping-col-confidence">
                    {row.confidence > 0 ? `${row.confidence}%` : "—"}
                  </td>
                  <td className="uc-migration-mapping-col-reason">{row.reason}</td>
                  <td className="uc-migration-mapping-col-status">
                    <span
                      className={
                        mapped
                          ? "uc-migration-mapping-badge uc-migration-mapping-badge--mapped"
                          : "uc-migration-mapping-badge uc-migration-mapping-badge--review"
                      }
                    >
                      {mapped ? "Mapped" : "Needs review"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
