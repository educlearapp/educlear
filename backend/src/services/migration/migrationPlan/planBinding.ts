/**
 * Helpers for Phase 1F authoritative compiled-plan binding.
 */

import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import type { CompiledMigrationPlan } from "../migrationPlan/CompiledMigrationPlan";
import type { MigrationSourceAnalysis } from "../sourceAnalysis/MigrationSourceAnalysis";

export function normalizeMappingsSignature(
  mappings: MigrationFileColumnMappings[]
): string {
  const normalized = (mappings || [])
    .map((f) => ({
      fileId: String(f.fileId || "").trim(),
      mappings: (f.mappings || [])
        .map((m) => ({
          sourceColumn: String(m.sourceColumn || "").trim(),
          targetField: String(m.targetField || "").trim(),
        }))
        .filter((m) => m.sourceColumn && m.targetField)
        .sort((a, b) =>
          `${a.sourceColumn}|${a.targetField}`.localeCompare(
            `${b.sourceColumn}|${b.targetField}`
          )
        ),
    }))
    .filter((f) => f.fileId)
    .sort((a, b) => a.fileId.localeCompare(b.fileId));
  return JSON.stringify(normalized);
}

/** True when client mappings are empty or equal to compiled plan mappings. */
export function clientMappingsCompatibleWithPlan(
  clientMappings: MigrationFileColumnMappings[],
  planMappings: MigrationFileColumnMappings[]
): boolean {
  const clientSig = normalizeMappingsSignature(clientMappings);
  if (clientSig === "[]" || clientSig === "") return true;
  // Empty per-file arrays still count as empty overall
  const hasAnyClient = (clientMappings || []).some((f) => (f.mappings || []).length > 0);
  if (!hasAnyClient) return true;
  return clientSig === normalizeMappingsSignature(planMappings);
}

export function assertCompiledPlanReadyForStage(
  plan: CompiledMigrationPlan,
  analysis: MigrationSourceAnalysis,
  targetSchoolId: string
): void {
  if (plan.targetSchoolId !== targetSchoolId || analysis.targetSchoolId !== targetSchoolId) {
    throw new Error(
      "MIGRATION_SCHOOL_MISMATCH: Compiled plan / analysis school does not match stage school."
    );
  }
  if (plan.sourceAnalysisId !== analysis.analysisId) {
    throw new Error(
      "MIGRATION_PLAN_STALE: Compiled plan is not bound to the provided Source Analysis."
    );
  }
  const byId = new Map(analysis.files.map((f) => [f.fileId, f.headerFingerprint]));
  for (const fp of plan.sourceFingerprints) {
    const current = byId.get(fp.fileId);
    if (!current || current !== fp.headerFingerprint) {
      throw new Error(
        "MIGRATION_PLAN_STALE: Source file headers changed after plan compile — re-analyse and recompile."
      );
    }
  }
  if (!plan.canProceedToStage) {
    const reasons = plan.blockedReasons.length
      ? plan.blockedReasons.join(" ")
      : "Compiled plan is not ready for staging.";
    throw new Error(reasons);
  }
}
