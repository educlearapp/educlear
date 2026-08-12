/**
 * Phase 1E — Source-first package analysis artifact (zero school writes).
 */

import type { MigrationTargetField } from "../types/MigrationTargetField";

export const MIGRATION_SOURCE_ANALYSIS_VERSION = "1E.1" as const;

export type SourceFieldStatus =
  | "AUTO_MAPPED"
  | "CONFIRM_MAPPING"
  | "UNSUPPORTED"
  | "SOURCE_ONLY_PRESERVED"
  | "INVALID";

export type MappingConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type SourceEntityKind =
  | "learners"
  | "parents"
  | "learner_parent_links"
  | "classrooms"
  | "grades"
  | "subjects_groups"
  | "employees"
  | "family_accounts"
  | "opening_balances"
  | "transactions_payments"
  | "billing_plans"
  | "addresses"
  | "medical_emergency"
  | "other";

export type DetectedSourceSystemId =
  | "kideesys"
  | "sasams"
  | "generic-excel-csv"
  | "generic-csv"
  | "generic-excel"
  | "unknown";

export type DiscoveredSourceField = {
  fieldKey: string;
  fileId: string;
  filename: string;
  sheetName?: string;
  sourceColumn: string;
  sampleValues: string[];
  inferredType: "string" | "number" | "date" | "mixed" | "empty";
  status: SourceFieldStatus;
  confidence: MappingConfidenceBand;
  suggestedTarget: MigrationTargetField | null;
  confirmedTarget?: MigrationTargetField | null;
  operatorAction?: "ACCEPT" | "CHOOSE" | "UNSUPPORTED" | null;
  reason: string;
  entityHint?: SourceEntityKind;
  /** Finance ambiguity flag — never auto-post. */
  financeRequiresConfirmation?: boolean;
};

export type AnalysedSourceFile = {
  fileId: string;
  filename: string;
  category: string;
  rowCount: number;
  columnCount: number;
  sheetNames: string[];
  path?: string;
  headerFingerprint: string;
};

export type RelationshipCandidate = {
  leftFileId: string;
  rightFileId: string;
  leftColumn: string;
  rightColumn: string;
  keyKind:
    | "learner_number"
    | "admission_number"
    | "learner_sa_id"
    | "parent_sa_id"
    | "account_number"
    | "family_code"
    | "classroom_code"
    | "other";
  confidence: MappingConfidenceBand;
  reason: string;
};

export type EntityGroupSummary = {
  entity: SourceEntityKind;
  fileIds: string[];
  estimatedRows: number;
  reason: string;
};

export type MigrationSourceAnalysisSummary = {
  fileCount: number;
  totalRows: number;
  totalFields: number;
  autoMapped: number;
  confirmMapping: number;
  unsupported: number;
  sourceOnlyPreserved: number;
  invalid: number;
  estimatedLearners: number;
  estimatedParents: number;
  estimatedClassrooms: number;
  estimatedFamilyAccounts: number;
  relationshipCount: number;
};

export type MigrationSourceAnalysis = {
  analysisId: string;
  analysisVersion: typeof MIGRATION_SOURCE_ANALYSIS_VERSION;
  createdAt: string;
  updatedAt: string;
  /** Bound run — equals stageId when staged; otherwise session-scoped temp id. */
  migrationRunId: string;
  stageId: string | null;
  targetSchoolId: string;
  targetSchoolName?: string;
  detectedSourceSystem: DetectedSourceSystemId;
  detectedSourceSystemLabel: string;
  files: AnalysedSourceFile[];
  discoveredFields: DiscoveredSourceField[];
  entityGroups: EntityGroupSummary[];
  relationshipCandidates: RelationshipCandidate[];
  summary: MigrationSourceAnalysisSummary;
  /** Operator confirmations keyed by fieldKey. */
  confirmedMappings: Record<
    string,
    {
      target: MigrationTargetField | null;
      action: "ACCEPT" | "CHOOSE" | "UNSUPPORTED";
      updatedAt: string;
    }
  >;
};

export type AnalyzeMigrationPackageFileInput = {
  fileId: string;
  filename: string;
  path?: string;
  category?: string;
  columns?: string[];
  sampleRows?: Record<string, unknown>[];
  rowCount?: number;
  sheetNames?: string[];
};

export type AnalyzeMigrationPackageInput = {
  targetSchoolId: string;
  targetSchoolName?: string;
  stageId?: string | null;
  migrationRunId?: string | null;
  systemIdHint?: string | null;
  files: AnalyzeMigrationPackageFileInput[];
  /** Prior confirmations to re-apply when fingerprints still match. */
  priorConfirmedMappings?: MigrationSourceAnalysis["confirmedMappings"];
  priorHeaderFingerprints?: Record<string, string>;
};
