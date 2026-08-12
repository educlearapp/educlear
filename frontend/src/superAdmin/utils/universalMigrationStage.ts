import { superAdminApiFetch } from "../superAdminApi";
import type { MigrationFileColumnMappings } from "./buildEffectiveFileMappings";
import type { MigrationFilePreview } from "./universalMigrationPreview";
import type {
  MigrationValidationIssue,
  MigrationValidationSummary,
} from "./universalMigrationValidate";

export type MigrationStagedCounts = {
  learners: number;
  parents: number;
  billingAccounts: number;
  transactions: number;
  staff: number;
  historical: number;
};

export type MigrationTransactionReadinessCounts = {
  historicalOnlyTransactions: number;
  eligibleActiveTransactions: number;
  blockedTransactions: number;
  unmatchedTransactions: number;
};

export type MigrationStageFileSummary = {
  fileId: string;
  filename: string;
  category: string;
  rowCount: number;
  path?: string;
};

export type PaymentReceiveListBalanceDifference = {
  accountNumber: string;
  learnerName?: string;
  ageAnalysisBalance: number;
  pdfBalance: number;
  difference: number;
};

export type PaymentReceiveListReconciliationSummary = {
  label: "Reconciliation only — does not affect balances.";
  optional: true;
  source: "Kid-e-Sys";
  category: "payment-receive-list";
  purpose: "reconciliation-only";
  pdfFileCount: number;
  totalPdfAccounts: number;
  ageAnalysisAccounts: number;
  totalMatchedAccounts: number;
  missingInAgeAnalysis: string[];
  missingInPdf: string[];
  balanceDifferences: PaymentReceiveListBalanceDifference[];
  totalOutstanding: number;
  totalCreditsOverpaid: number;
  netPosition: number;
  ageAnalysisNetPosition: number;
};

export type PaymentReceiveListStageData = {
  label: "Reconciliation only — does not affect balances.";
  optional: true;
  source: "Kid-e-Sys";
  category: "payment-receive-list";
  purpose: "reconciliation-only";
  files: Array<{
    fileId: string;
    filename: string;
    rows: Array<Record<string, unknown>>;
  }>;
  reconciliation: PaymentReceiveListReconciliationSummary;
};

export type MigrationStage = {
  stageId: string;
  migrationRunId?: string;
  createdAt: string;
  sourceSystem: string;
  /** Immutable school binding for this dry run. */
  targetSchoolId: string;
  targetSchoolName: string;
  cutoverDate?: string;
  files: MigrationStageFileSummary[];
  mappings: MigrationFileColumnMappings[];
  validationSummary: MigrationValidationSummary;
  stagedCounts: MigrationStagedCounts;
  transactionReadiness: MigrationTransactionReadinessCounts;
  paymentReceiveList?: PaymentReceiveListStageData;
  warnings: string[];
  canApply: boolean;
  sourceAnalysisId?: string | null;
  analysisVersion?: string | null;
  compiledPlanId?: string | null;
  compiledPlanVersion?: string | null;
  sourceFingerprints?: Array<{
    fileId: string;
    filename: string;
    headerFingerprint: string;
  }>;
};

export type MigrationStageListItem = Pick<
  MigrationStage,
  | "stageId"
  | "migrationRunId"
  | "createdAt"
  | "sourceSystem"
  | "targetSchoolId"
  | "targetSchoolName"
  | "stagedCounts"
  | "canApply"
> & {
  fileCount: number;
};

export async function createUniversalMigrationStage(input: {
  sourceSystem: string;
  /** Required — locks the dry run to this school. */
  schoolId: string;
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  validationSummary: MigrationValidationSummary;
  issues: MigrationValidationIssue[];
  /** fileId → staging disk path from upload */
  filePaths?: Record<string, string>;
  cutoverDate?: string;
  sourceAnalysisId?: string;
  compiledPlanId?: string;
}): Promise<MigrationStage> {
  const previewsWithPaths = input.previews.map((p) => ({
    ...p,
    path: p.path || input.filePaths?.[p.fileId] || undefined,
  }));
  if (!String(input.schoolId || "").trim()) {
    throw new Error("schoolId is required to create a dry run");
  }
  const data = (await superAdminApiFetch("/api/migration/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceSystem: input.sourceSystem,
      schoolId: input.schoolId,
      previews: previewsWithPaths,
      mappings: input.mappings,
      validationSummary: input.validationSummary,
      issues: input.issues,
      ...(input.cutoverDate ? { cutoverDate: input.cutoverDate } : {}),
      ...(input.sourceAnalysisId ? { sourceAnalysisId: input.sourceAnalysisId } : {}),
      ...(input.compiledPlanId ? { compiledPlanId: input.compiledPlanId } : {}),
    }),
  })) as { success?: boolean; stage?: MigrationStage; error?: string };

  if (!data?.success || !data.stage) {
    throw new Error(data?.error || "Failed to create dry run stage");
  }

  return data.stage;
}

export async function fetchUniversalMigrationStages(opts?: {
  targetSchoolId?: string;
}): Promise<MigrationStageListItem[]> {
  const qs = opts?.targetSchoolId
    ? `?targetSchoolId=${encodeURIComponent(opts.targetSchoolId)}`
    : "";
  const data = (await superAdminApiFetch(`/api/migration/stages${qs}`)) as {
    success?: boolean;
    stages?: MigrationStageListItem[];
    error?: string;
  };

  if (!data?.success || !Array.isArray(data.stages)) {
    throw new Error(data?.error || "Failed to list dry runs");
  }

  return data.stages;
}

export async function fetchUniversalMigrationStage(
  stageId: string
): Promise<MigrationStage> {
  const data = (await superAdminApiFetch(
    `/api/migration/stages/${encodeURIComponent(stageId)}`
  )) as { success?: boolean; stage?: MigrationStage; error?: string };

  if (!data?.success || !data.stage) {
    throw new Error(data?.error || "Failed to load dry run");
  }

  return data.stage;
}

export async function deleteUniversalMigrationStage(stageId: string): Promise<void> {
  const data = (await superAdminApiFetch(
    `/api/migration/stages/${encodeURIComponent(stageId)}`,
    { method: "DELETE" }
  )) as { success?: boolean; error?: string };

  if (!data?.success) {
    throw new Error(data?.error || "Failed to delete dry run");
  }
}
