/**
 * Phase 1L — Universal Migration Orchestrator types.
 * Coordination only — domain services remain authoritative.
 */

export const UNIVERSAL_ORCHESTRATOR_VERSION = "1M.1" as const;

export type MigrationDomainId =
  | "CORE"
  | "PARENTS_FAMILIES"
  | "ACADEMIC"
  | "FINANCE"
  | "STATEMENTS"
  | "FEE_CHECK";

export type DomainOperatorStatus =
  | "NOT_DETECTED"
  | "ANALYSING"
  | "READY"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "APPLIED"
  | "VERIFIED"
  | "STALE"
  | "FAILED"
  | "SKIPPED";

export type OverallMigrationStatus =
  | "ANALYSING"
  | "NEEDS_ATTENTION"
  | "READY_TO_MIGRATE"
  | "MIGRATING"
  | "VERIFYING"
  | "COMPLETE"
  | "COMPLETE_ACCEPTED"
  | "COMPLETE_SUPPLIED_DATA"
  | "COMPLETE_WITH_WARNINGS"
  | "BLOCKED"
  | "FAILED";

export type MigrationTerminalKind =
  | "COMPLETE_ACCEPTED"
  | "COMPLETE_SUPPLIED_DATA"
  | "COMPLETE_WITH_WARNINGS"
  | null;

export type AttentionSeverity = "BLOCKING" | "WARNING" | "INFORMATION";

export type AttentionItem = {
  attentionId: string;
  domainId: MigrationDomainId;
  severity: AttentionSeverity;
  title: string;
  message: string;
  /** Deep-link hint for UI (section key), not internal phase names. */
  reviewSection: string;
  proposalId?: string;
  kind?: string;
};

export type DomainStatusSnapshot = {
  domainId: MigrationDomainId;
  label: string;
  applicable: boolean;
  status: DomainOperatorStatus;
  plainLanguage: string;
  metrics: Record<string, number | string | boolean | null>;
  blockingCount: number;
  warningCount: number;
};

export type UniversalMigrationReadiness = {
  readinessId: string;
  version: typeof UNIVERSAL_ORCHESTRATOR_VERSION;
  generatedAt: string;
  targetSchoolId: string;
  stageId: string | null;
  overallStatus: OverallMigrationStatus;
  plainLanguageOverall: string;
  applicableDomains: MigrationDomainId[];
  domains: DomainStatusSnapshot[];
  attentionItems: AttentionItem[];
  blockingIssueCount: number;
  warningCount: number;
  informationCount: number;
  staleDomains: MigrationDomainId[];
  failedDomains: MigrationDomainId[];
  readyToComplete: boolean;
  /** Accept Migration can be called (finance/statement/fee gates satisfiable). */
  readyToAccept: boolean;
  sourceFingerprint: string | null;
  summaryLines: string[];
  operatorEffort: {
    manualMappingActionsRequired: number;
    operatorReviewDecisionsRequired: number;
    primaryActionsAfterAnalysis: number;
  };
};

export type OrchestratorProgressStep =
  | "ANALYSING_SOURCE"
  | "COMPILING_PLANS"
  | "PREPARING_LEARNERS"
  | "LINKING_PARENTS"
  | "PREPARING_ACADEMIC"
  | "CHECKING_ACCOUNTS"
  | "VERIFYING_STATEMENTS"
  | "VERIFYING_FEE_CHECK"
  | "FINAL_SAFETY_CHECK"
  | "COMPLETE"
  | "FAILED";

export type OrchestratorRunRecord = {
  runId: string;
  version: typeof UNIVERSAL_ORCHESTRATOR_VERSION;
  targetSchoolId: string;
  stageId: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  status: OverallMigrationStatus;
  currentStep: OrchestratorProgressStep;
  stepsCompleted: OrchestratorProgressStep[];
  domainsApplied: MigrationDomainId[];
  domainsSkipped: MigrationDomainId[];
  domainsFailed: Array<{ domainId: MigrationDomainId; reason: string }>;
  replayProtected: boolean;
  idempotentReplay: boolean;
  acceptanceId: string | null;
  /** Phase 1M terminal classification — never claims finance verified when not supplied. */
  terminalKind: MigrationTerminalKind;
  sourceSetFingerprint?: string | null;
  summary: {
    learners?: number;
    parents?: number;
    links?: number;
    classrooms?: number;
    subjects?: number;
    accounts?: number;
    warnings: string[];
  };
  audit: Array<{ at: string; event: string; detail?: string }>;
};

export type AutomaticAnalysisResult = {
  analysisId: string;
  targetSchoolId: string;
  stageId: string | null;
  generatedAt: string;
  steps: string[];
  readiness: UniversalMigrationReadiness;
};
