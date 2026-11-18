/** Client helpers for Phase 1L Universal Migration Orchestrator. */

import { getSuperAdminToken } from "../../auth/superAdminSession";

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

function authHeaders(): Record<string, string> {
  const token = getSuperAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(data: Record<string, unknown>, fallback: string): string {
  const err = data?.error;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

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
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseJson(res);
  if (!res.ok || !data?.success) {
    throw new Error(errorMessage(data, "EduClear could not analyse the uploaded files."));
  }
  return data as {
    stageId: string;
    stage: Record<string, unknown>;
    readiness: UniversalMigrationReadiness;
    steps: string[];
    plainLanguage: string;
    reusedExistingStage: boolean;
  };
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseJson(res);
  if (!res.ok || !data?.success) {
    throw new Error(errorMessage(data, "Analyse failed"));
  }
  return {
    readiness: data.readiness as UniversalMigrationReadiness,
    steps: (data.steps as string[]) || [],
  };
}

export async function getOrchestratorReadiness(input: {
  stageId: string;
  targetSchoolId: string;
}): Promise<{ readiness: UniversalMigrationReadiness; run: OrchestratorRun | null }> {
  const q = new URLSearchParams({ targetSchoolId: input.targetSchoolId });
  const res = await fetch(
    `/api/migration/orchestrator/readiness/${encodeURIComponent(input.stageId)}?${q}`,
    { credentials: "include", headers: { ...authHeaders() } }
  );
  const data = await parseJson(res);
  if (!res.ok || !data?.success) {
    throw new Error(errorMessage(data, "Readiness failed"));
  }
  return {
    readiness: data.readiness as UniversalMigrationReadiness,
    run: (data.run as OrchestratorRun | null) ?? null,
  };
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseJson(res);
  if (!res.ok || !data?.success) {
    throw new Error(errorMessage(data, "Complete migration failed"));
  }
  return {
    run: data.run as OrchestratorRun,
    readiness: data.readiness as UniversalMigrationReadiness,
    plainLanguage: String(data.plainLanguage || ""),
  };
}
