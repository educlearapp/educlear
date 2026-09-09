/**
 * Compile Source Analysis confirmed/auto mappings → MigrationFileColumnMappings.
 */

import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type { MigrationSourceAnalysis } from "../sourceAnalysis/MigrationSourceAnalysis";
import type { CompiledMappingEntry } from "./CompiledMigrationPlan";

const FLOWING_STATUSES = new Set(["AUTO_MAPPED", "CONFIRM_MAPPING"]);

/**
 * Deterministic compiler: only AUTO_MAPPED and operator-confirmed fields become stage mappings.
 * UNSUPPORTED / SOURCE_ONLY_PRESERVED / unresolved CONFIRM without acceptance do not flow.
 */
export function compileMappingsFromAnalysis(
  analysis: MigrationSourceAnalysis
): {
  mappings: MigrationFileColumnMappings[];
  entries: CompiledMappingEntry[];
} {
  const entries: CompiledMappingEntry[] = [];
  const byFile = new Map<string, Array<{ sourceColumn: string; targetField: MigrationTargetField }>>();

  for (const field of analysis.discoveredFields) {
    const confirmed = analysis.confirmedMappings[field.fieldKey];
    let target: MigrationTargetField | null = null;
    let flows = false;
    let fieldTrace: CompiledMappingEntry["fieldTrace"] = "unresolved";
    let reason = field.reason;

    if (field.status === "UNSUPPORTED" || confirmed?.action === "UNSUPPORTED") {
      fieldTrace = "unsupported";
      reason = field.reason || "Unsupported source field";
    } else if (field.status === "INVALID") {
      fieldTrace = "invalid";
    } else if (field.status === "SOURCE_ONLY_PRESERVED" && !confirmed?.target) {
      fieldTrace = "unsupported";
      reason = "Preserved as source-only — no EduClear destination";
    } else if (confirmed && (confirmed.action === "ACCEPT" || confirmed.action === "CHOOSE")) {
      target = confirmed.target;
      flows = Boolean(target);
      fieldTrace = flows ? "planned" : "unsupported";
      reason = flows ? "Operator-confirmed mapping" : "Operator marked without target";
    } else if (field.status === "AUTO_MAPPED" && field.suggestedTarget) {
      // HIGH confidence auto-map flows without re-prompt
      target = field.suggestedTarget;
      flows = true;
      fieldTrace = "planned";
      reason = field.reason || "High-confidence automatic mapping";
    } else if (field.status === "CONFIRM_MAPPING") {
      fieldTrace = "unresolved";
      reason = "Needs operator confirmation before staging";
    }

    // admissionDate now persists on Learner when mapped.
    if (target === "admissionDate") {
      // keep flows as computed above
    }

    // Finance ambiguous never auto-flows even if suggested
    if (field.financeRequiresConfirmation && !confirmed) {
      flows = false;
      target = null;
      fieldTrace = "unresolved";
      reason =
        "Finance-like column requires confirmation (opening balance vs payment vs other).";
    }

    entries.push({
      fileId: field.fileId,
      sourceColumn: field.sourceColumn,
      target,
      status: field.status,
      fieldTrace,
      reason,
    });

    if (flows && target) {
      const list = byFile.get(field.fileId) || [];
      // First mapping wins per source column (deterministic order of discoveredFields)
      if (!list.some((m) => m.sourceColumn === field.sourceColumn)) {
        list.push({ sourceColumn: field.sourceColumn, targetField: target });
      }
      byFile.set(field.fileId, list);
    }
  }

  const mappings: MigrationFileColumnMappings[] = analysis.files.map((f) => ({
    fileId: f.fileId,
    mappings: byFile.get(f.fileId) || [],
  }));

  return { mappings, entries };
}
