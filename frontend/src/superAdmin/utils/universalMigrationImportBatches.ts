import { API_URL } from "../../api";
import { getSuperAdminToken } from "../../auth/superAdminSession";
import type { MigrationApplyCounts, MigrationImportReportRow } from "./universalMigrationApply";

export type MigrationImportBatchStatus =
  | "pending"
  | "applying"
  | "completed"
  | "failed"
  | "rolled_back";

export type MigrationImportBatchSummary = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  status: MigrationImportBatchStatus;
  createdAt: string;
  completedAt?: string;
  rolledBackAt?: string;
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  hasCreatedTransactions: boolean;
};

export type MigrationRollbackReportRow = {
  entityType: string;
  recordId: string;
  status: "deleted" | "skipped" | "blocked";
  message: string;
};

export type MigrationImportBatchDetail = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  sourceSystem: string;
  status: MigrationImportBatchStatus;
  createdAt: string;
  completedAt?: string;
  rolledBackAt?: string;
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  reportRows: MigrationImportReportRow[];
  rollbackReport?: MigrationRollbackReportRow[];
  reversalReport?: MigrationReversalReportRow[];
};

export type MigrationRollbackResult = {
  batchId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  rolledBackAt: string;
  success: boolean;
  deletedCounts: MigrationApplyCounts;
  blockedCounts: MigrationApplyCounts;
  report: MigrationRollbackReportRow[];
};

export type MigrationReversalReportRow = {
  entityType: "transaction";
  recordId: string;
  status: "reversed" | "skipped" | "failed";
  message: string;
  reversalRecordId?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  rowNumber?: number;
};

export type MigrationReversalResult = {
  batchId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  rolledBackAt: string;
  success: boolean;
  reversedCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  report: MigrationReversalReportRow[];
};

export type MigrationReconciliationStatus = "pass" | "warning" | "fail";

export type MigrationReconciliationCheck = {
  id: string;
  check: string;
  expected: string;
  actual: string;
  status: MigrationReconciliationStatus;
  message: string;
};

export type MigrationReconciliationSummary = {
  passed: number;
  warnings: number;
  failed: number;
  total: number;
};

export type MigrationParentReconciliationMatchSignal =
  | "same_cellphone"
  | "same_email"
  | "same_relationship"
  | "similar_names";

export type MigrationParentReconciliationParent = {
  parentId: string;
  name: string;
  relationship: string | null;
  cellphone: string | null;
  email: string | null;
  learnerNames: string[];
};

export type MigrationParentReconciliationSuggestion = {
  suggestionId: string;
  status: "suggested";
  confidence: "high" | "medium";
  matchSignals: MigrationParentReconciliationMatchSignal[];
  primaryParent: MigrationParentReconciliationParent;
  duplicateParent: MigrationParentReconciliationParent;
  action: "review_merge_or_ignore";
  note: string;
};

export type MigrationParentReconciliationSummary = {
  totalSuggestedMerges: number;
  suggestions: MigrationParentReconciliationSuggestion[];
  note: string;
};

export type MigrationReconciliationResult = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  batchStatus: MigrationImportBatchStatus;
  reconciledAt: string;
  overallStatus: MigrationReconciliationStatus;
  summary: MigrationReconciliationSummary;
  checks: MigrationReconciliationCheck[];
  parentReconciliation?: MigrationParentReconciliationSummary;
};

function authHeaders(): Record<string, string> {
  const token = getSuperAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export async function fetchUniversalMigrationImportBatches(): Promise<
  MigrationImportBatchSummary[]
> {
  const res = await fetch(`${API_URL}/api/migration/import-batches`, {
    headers: authHeaders(),
  });
  const data = await parseJsonResponse<{ success?: boolean; batches?: MigrationImportBatchSummary[]; error?: string }>(
    res
  );
  if (!res.ok) throw new Error(data.error || `Failed to list import batches (${res.status})`);
  return data.batches ?? [];
}

export async function fetchUniversalMigrationImportBatch(
  batchId: string
): Promise<{ batch: MigrationImportBatchDetail; hasCreatedTransactions: boolean }> {
  const res = await fetch(`${API_URL}/api/migration/import-batches/${encodeURIComponent(batchId)}`, {
    headers: authHeaders(),
  });
  const data = await parseJsonResponse<{
    success?: boolean;
    batch?: MigrationImportBatchDetail;
    hasCreatedTransactions?: boolean;
    error?: string;
  }>(res);
  if (!res.ok || !data.batch) {
    throw new Error(data.error || `Failed to load import batch (${res.status})`);
  }
  return {
    batch: data.batch,
    hasCreatedTransactions: Boolean(data.hasCreatedTransactions),
  };
}

export async function rollbackUniversalMigrationImportBatch(input: {
  batchId: string;
  targetSchoolId: string;
  confirmationText: string;
}): Promise<MigrationRollbackResult> {
  const res = await fetch(
    `${API_URL}/api/migration/import-batches/${encodeURIComponent(input.batchId)}/rollback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        targetSchoolId: input.targetSchoolId,
        confirmationText: input.confirmationText,
      }),
    }
  );
  const data = await parseJsonResponse<{
    success?: boolean;
    result?: MigrationRollbackResult;
    error?: string;
  }>(res);
  if (!res.ok || !data.result) {
    throw new Error(data.error || `Rollback failed (${res.status})`);
  }
  return data.result;
}

export async function reverseUniversalMigrationLedgerBatch(input: {
  batchId: string;
  targetSchoolId: string;
  confirmationText: string;
}): Promise<MigrationReversalResult> {
  const res = await fetch(
    `${API_URL}/api/migration/import-batches/${encodeURIComponent(input.batchId)}/reverse-ledger`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        targetSchoolId: input.targetSchoolId,
        confirmationText: input.confirmationText,
      }),
    }
  );
  const data = await parseJsonResponse<{
    success?: boolean;
    result?: MigrationReversalResult;
    error?: string;
  }>(res);
  if (!res.ok || !data.result) {
    throw new Error(data.error || `Reversal rollback failed (${res.status})`);
  }
  return data.result;
}

export async function reconcileUniversalMigrationImportBatch(input: {
  batchId: string;
  targetSchoolId: string;
}): Promise<MigrationReconciliationResult> {
  const res = await fetch(
    `${API_URL}/api/migration/import-batches/${encodeURIComponent(input.batchId)}/reconcile`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ targetSchoolId: input.targetSchoolId }),
    }
  );
  const data = await parseJsonResponse<{
    success?: boolean;
    reconciliation?: MigrationReconciliationResult;
    error?: string;
  }>(res);
  if (!res.ok || !data.reconciliation) {
    throw new Error(data.error || `Reconciliation failed (${res.status})`);
  }
  return data.reconciliation;
}
