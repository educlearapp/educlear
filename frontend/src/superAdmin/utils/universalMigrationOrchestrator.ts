/** Client helpers for Phase 1L Universal Migration Orchestrator. */

export type DomainStatusSnapshot = {
  domainId: string;
  label: string;
  applicable: boolean;
  status: string;
  plainLanguage: string;
  metrics: Record<string, unknown>;
  blockingCount: number;
  warningCount: number;
};

export type AttentionItem = {
  attentionId: string;
  domainId: string;
  severity: "BLOCKING" | "WARNING" | "INFORMATION";
  title: string;
  message: string;
  reviewSection: string;
  proposalId?: string;
};

export type UniversalMigrationReadiness = {
  readinessId: string;
  overallStatus: string;
  plainLanguageOverall: string;
  domains: DomainStatusSnapshot[];
  attentionItems: AttentionItem[];
  blockingIssueCount: number;
  warningCount: number;
  readyToComplete: boolean;
  readyToAccept: boolean;
  summaryLines: string[];
  operatorEffort: {
    manualMappingActionsRequired: number;
    operatorReviewDecisionsRequired: number;
    primaryActionsAfterAnalysis: number;
  };
};

export type OrchestratorRun = {
  runId: string;
  status: string;
  currentStep: string;
  stepsCompleted: string[];
  domainsApplied: string[];
  domainsSkipped: string[];
  domainsFailed: Array<{ domainId: string; reason: string }>;
  idempotentReplay: boolean;
  summary: Record<string, unknown>;
};

export async function postOrchestratorPrepare(input: {
  targetSchoolId: string;
  targetSchoolName?: string;
  sourceSystem?: string;
  cutoverDate?: string;
  forceRecompile?: boolean;
}): Promise<{
  stageId: string;
  stage: Record<string, unknown>;
  readiness: UniversalMigrationReadiness;
  steps: string[];
  plainLanguage: string;
  reusedExistingStage: boolean;
}> {
  const res = await fetch("/api/migration/orchestrator/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "EduClear could not analyse the uploaded files.");
  }
  return data;
}

export async function postOrchestratorAnalyse(input: {
  stageId: string;
  targetSchoolId: string;
  forceRecompile?: boolean;
}): Promise<{
  readiness: UniversalMigrationReadiness;
  steps: string[];
}> {
  const res = await fetch("/api/migration/orchestrator/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Analyse failed");
  return { readiness: data.readiness, steps: data.steps || [] };
}

export async function getOrchestratorReadiness(input: {
  stageId: string;
  targetSchoolId: string;
}): Promise<{ readiness: UniversalMigrationReadiness; run: OrchestratorRun | null }> {
  const q = new URLSearchParams({ targetSchoolId: input.targetSchoolId });
  const res = await fetch(
    `/api/migration/orchestrator/readiness/${encodeURIComponent(input.stageId)}?${q}`,
    { credentials: "include" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Readiness failed");
  return { readiness: data.readiness, run: data.run ?? null };
}

export async function postOrchestratorComplete(input: {
  stageId: string;
  targetSchoolId: string;
  confirmation: boolean;
}): Promise<{
  run: OrchestratorRun;
  readiness: UniversalMigrationReadiness;
  plainLanguage: string;
}> {
  const res = await fetch("/api/migration/orchestrator/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Complete migration failed");
  return {
    run: data.run,
    readiness: data.readiness,
    plainLanguage: data.plainLanguage || "",
  };
}
