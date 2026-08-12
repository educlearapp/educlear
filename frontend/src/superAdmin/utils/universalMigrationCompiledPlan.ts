import { superAdminApiFetch } from "../superAdminApi";

export type CompiledMigrationPlanSummary = {
  learnersToCreate: number;
  learnersAlreadyPresent: number;
  parentsToCreate: number;
  parentsToReuse: number;
  parentLinks: number;
  classrooms: number;
  familyAccounts: number;
  employees: number;
  fieldsUnsupported: number;
  fieldsUnresolved: number;
  itemsNeedingAttention: number;
  financePlannedNotApplicable: number;
  joinsAuto: number;
  joinsNeedsConfirmation: number;
};

export type CompiledMigrationPlan = {
  planId: string;
  planVersion: string;
  createdAt: string;
  updatedAt: string;
  sourceAnalysisId: string;
  analysisVersion: string;
  targetSchoolId: string;
  targetSchoolName?: string;
  stageId: string | null;
  migrationRunId: string;
  summary: CompiledMigrationPlanSummary;
  blockedReasons: string[];
  canProceedToStage: boolean;
  learners: { extendedFieldsIncluded: string[] };
  parents: { extendedFieldsIncluded: string[]; needsReview: number };
  finance: Array<{
    kind: string;
    applicability: string;
    reason: string;
    countEstimate: number;
  }>;
  unsupportedFields: Array<{ sourceColumn: string; filename: string; reason: string }>;
  unresolvedMappings: Array<{ sourceColumn: string; filename: string; reason: string }>;
  joins: Array<{
    keyKind: string;
    autoLink: boolean;
    requiresConfirmation: boolean;
    confidence: string;
    reason: string;
  }>;
};

export async function compileUniversalMigrationPlan(input: {
  targetSchoolId: string;
  sourceAnalysisId: string;
}): Promise<CompiledMigrationPlan> {
  const data = (await superAdminApiFetch("/api/migration/compile-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetSchoolId: input.targetSchoolId,
      sourceAnalysisId: input.sourceAnalysisId,
    }),
  })) as { success?: boolean; plan?: CompiledMigrationPlan; error?: string };

  if (!data?.success || !data.plan) {
    throw new Error(data?.error || "Failed to compile migration plan");
  }
  return data.plan;
}

export async function fetchUniversalMigrationCompiledPlan(input: {
  planId: string;
  targetSchoolId: string;
}): Promise<CompiledMigrationPlan> {
  const qs = `?targetSchoolId=${encodeURIComponent(input.targetSchoolId)}`;
  const data = (await superAdminApiFetch(
    `/api/migration/compiled-plans/${encodeURIComponent(input.planId)}${qs}`
  )) as { success?: boolean; plan?: CompiledMigrationPlan; error?: string };

  if (!data?.success || !data.plan) {
    throw new Error(data?.error || "Compiled plan not found");
  }
  return data.plan;
}
