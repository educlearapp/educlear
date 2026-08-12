import { superAdminApiFetch } from "../superAdminApi";

export type SourceFieldStatus =
  | "AUTO_MAPPED"
  | "CONFIRM_MAPPING"
  | "UNSUPPORTED"
  | "SOURCE_ONLY_PRESERVED"
  | "INVALID";

export type MappingConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type DiscoveredSourceField = {
  fieldKey: string;
  fileId: string;
  filename: string;
  sheetName?: string;
  sourceColumn: string;
  sampleValues: string[];
  inferredType: string;
  status: SourceFieldStatus;
  confidence: MappingConfidenceBand;
  suggestedTarget: string | null;
  confirmedTarget?: string | null;
  operatorAction?: "ACCEPT" | "CHOOSE" | "UNSUPPORTED" | null;
  reason: string;
  financeRequiresConfirmation?: boolean;
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
  analysisVersion: string;
  createdAt: string;
  updatedAt: string;
  migrationRunId: string;
  stageId: string | null;
  targetSchoolId: string;
  targetSchoolName?: string;
  detectedSourceSystem: string;
  detectedSourceSystemLabel: string;
  files: Array<{
    fileId: string;
    filename: string;
    category: string;
    rowCount: number;
    columnCount: number;
    sheetNames: string[];
    headerFingerprint: string;
  }>;
  discoveredFields: DiscoveredSourceField[];
  entityGroups: Array<{
    entity: string;
    fileIds: string[];
    estimatedRows: number;
    reason: string;
  }>;
  relationshipCandidates: Array<{
    leftFileId: string;
    rightFileId: string;
    leftColumn: string;
    rightColumn: string;
    keyKind: string;
    confidence: MappingConfidenceBand;
    reason: string;
  }>;
  summary: MigrationSourceAnalysisSummary;
  confirmedMappings: Record<string, unknown>;
};

export function operatorFieldStatusLabel(status: SourceFieldStatus): string {
  switch (status) {
    case "AUTO_MAPPED":
      return "Mapped automatically";
    case "CONFIRM_MAPPING":
      return "Please confirm";
    case "UNSUPPORTED":
      return "Currently unsupported";
    case "SOURCE_ONLY_PRESERVED":
      return "We could not identify this field";
    case "INVALID":
      return "Invalid column";
    default:
      return status;
  }
}

export async function runUniversalMigrationSourceAnalysis(input: {
  targetSchoolId: string;
  targetSchoolName?: string;
  stageId?: string;
  systemIdHint?: string;
  priorAnalysisId?: string;
  files: Array<{
    fileId: string;
    filename: string;
    path?: string;
    category?: string;
    columns?: string[];
    sampleRows?: Record<string, unknown>[];
    rowCount?: number;
  }>;
}): Promise<MigrationSourceAnalysis> {
  const data = (await superAdminApiFetch("/api/migration/source-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as { success?: boolean; analysis?: MigrationSourceAnalysis; error?: string };

  if (!data?.success || !data.analysis) {
    throw new Error(data?.error || "Source analysis failed");
  }
  return data.analysis;
}

export async function confirmSourceAnalysisField(input: {
  analysisId: string;
  targetSchoolId: string;
  fieldKey: string;
  action: "ACCEPT" | "CHOOSE" | "UNSUPPORTED";
  target?: string | null;
}): Promise<MigrationSourceAnalysis> {
  const data = (await superAdminApiFetch(
    `/api/migration/source-analysis/${encodeURIComponent(input.analysisId)}/confirm-field`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetSchoolId: input.targetSchoolId,
        fieldKey: input.fieldKey,
        action: input.action,
        target: input.target ?? null,
      }),
    }
  )) as { success?: boolean; analysis?: MigrationSourceAnalysis; error?: string };

  if (!data?.success || !data.analysis) {
    throw new Error(data?.error || "Field confirmation failed");
  }
  return data.analysis;
}
