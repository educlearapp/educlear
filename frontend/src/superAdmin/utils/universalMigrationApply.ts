import { API_URL } from "../../api";

export type MigrationApplyCounts = {
  learners: number;
  parents: number;
  employees: number;
  billingAccounts: number;
  transactions: number;
  classrooms: number;
  parentLearnerLinks: number;
};

export type MigrationImportReportRow = {
  entityType: string;
  sourceFileId: string;
  sourceFilename: string;
  rowNumber: number;
  status: "created" | "skipped" | "failed" | "not_applied";
  message: string;
  key?: string;
  recordId?: string;
};

export type MigrationTransactionOutcomeCounts = {
  posted: number;
  historicalNotApplied: number;
  blocked: number;
  unmatched: number;
  duplicateSkipped: number;
};

export type MigrationApplyResult = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  appliedAt: string;
  success: boolean;
  error?: string;
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  transactionOutcomes?: MigrationTransactionOutcomeCounts;
  report: MigrationImportReportRow[];
};

export class UniversalMigrationApplyError extends Error {
  result: MigrationApplyResult | null;

  constructor(message: string, result: MigrationApplyResult | null = null) {
    super(message);
    this.name = "UniversalMigrationApplyError";
    this.result = result;
  }
}

export async function applyUniversalMigrationStage(input: {
  stageId: string;
  targetSchoolId: string;
  confirmationText: string;
  proceedWithEligibleActiveOnly?: boolean;
}): Promise<MigrationApplyResult> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_URL}/api/migration/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });

  const text = await res.text();
  let data: {
    success?: boolean;
    result?: MigrationApplyResult;
    error?: string;
  } | null = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new UniversalMigrationApplyError(
      data?.error || `Migration apply failed (${res.status})`,
      data?.result ?? null
    );
  }

  if (!data?.success || !data.result) {
    throw new UniversalMigrationApplyError(data?.error || "Migration apply failed", null);
  }

  return data.result;
}
