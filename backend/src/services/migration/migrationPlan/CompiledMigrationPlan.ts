/**
 * Phase 1F — Compiled migration plan (zero school writes until apply).
 * Source Analysis → deterministic mappings → entity/link/finance plans.
 */

import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type { SourceFieldStatus } from "../sourceAnalysis/MigrationSourceAnalysis";

export const COMPILED_MIGRATION_PLAN_VERSION = "1F.1" as const;

export type PlanRecordAction = "CREATE" | "REUSE" | "SKIP" | "REVIEW" | "BLOCKED";

export type FieldTraceStatus =
  | "imported"
  | "linked_existing"
  | "skipped"
  | "unsupported"
  | "invalid"
  | "unresolved"
  | "planned";

export type FinancePlanKind =
  | "family_account"
  | "opening_balance"
  | "payment"
  | "transaction"
  | "billing_plan"
  | "credit_adjustment"
  | "ambiguous";

export type FinanceApplicability = "APPLICABLE_SAFE_PATH" | "PLANNED_NOT_APPLICABLE" | "REQUIRES_CONFIRMATION";

export type CompiledJoinConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CompiledFileFingerprint = {
  fileId: string;
  filename: string;
  headerFingerprint: string;
};

export type CompiledMappingEntry = {
  fileId: string;
  sourceColumn: string;
  target: MigrationTargetField | null;
  status: SourceFieldStatus;
  fieldTrace: FieldTraceStatus;
  reason: string;
};

export type PlannedLearnerSummary = {
  action: PlanRecordAction;
  count: number;
  extendedFieldsIncluded: string[];
};

export type PlannedParentSummary = {
  toCreate: number;
  toReuse: number;
  needsReview: number;
  linksPlanned: number;
  extendedFieldsIncluded: string[];
};

export type PlannedClassroomSummary = {
  toCreate: number;
  toReuse: number;
};

export type PlannedFamilyAccountSummary = {
  toCreate: number;
  toReuse: number;
};

export type PlannedEmployeeSummary = {
  toCreate: number;
  toSkip: number;
};

export type PlannedJoin = {
  joinId: string;
  keyKind: string;
  leftFileId: string;
  rightFileId: string;
  leftColumn: string;
  rightColumn: string;
  confidence: CompiledJoinConfidence;
  autoLink: boolean;
  requiresConfirmation: boolean;
  reason: string;
};

export type PlannedFinanceItem = {
  itemId: string;
  kind: FinancePlanKind;
  applicability: FinanceApplicability;
  fileId?: string;
  sourceColumn?: string;
  countEstimate: number;
  reason: string;
};

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
  planVersion: typeof COMPILED_MIGRATION_PLAN_VERSION;
  createdAt: string;
  updatedAt: string;
  sourceAnalysisId: string;
  analysisVersion: string;
  targetSchoolId: string;
  targetSchoolName?: string;
  stageId: string | null;
  migrationRunId: string;
  sourceFingerprints: CompiledFileFingerprint[];
  compiledMappings: MigrationFileColumnMappings[];
  mappingEntries: CompiledMappingEntry[];
  learners: PlannedLearnerSummary;
  parents: PlannedParentSummary;
  classrooms: PlannedClassroomSummary;
  familyAccounts: PlannedFamilyAccountSummary;
  employees: PlannedEmployeeSummary;
  joins: PlannedJoin[];
  finance: PlannedFinanceItem[];
  unsupportedFields: Array<{
    fieldKey: string;
    sourceColumn: string;
    filename: string;
    reason: string;
  }>;
  unresolvedMappings: Array<{
    fieldKey: string;
    sourceColumn: string;
    filename: string;
    reason: string;
  }>;
  summary: CompiledMigrationPlanSummary;
  blockedReasons: string[];
  canProceedToStage: boolean;
};

export type CompileMigrationPlanInput = {
  analysis: import("../sourceAnalysis/MigrationSourceAnalysis").MigrationSourceAnalysis;
  /** Optional existing school snapshot for reuse/skip estimates (zero-write). */
  existing?: {
    learnerKeys?: Set<string>;
    classroomNames?: Set<string>;
    accountRefs?: Set<string>;
    employeeKeys?: Set<string>;
  };
};
