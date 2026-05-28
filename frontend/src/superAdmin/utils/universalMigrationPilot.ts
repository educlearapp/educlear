import { API_URL } from "../../api";
import type { MigrationReconciliationStatus } from "./universalMigrationImportBatches";
import type { MigrationValidationSummary } from "./universalMigrationValidate";

export type MigrationPilotStatus = "draft" | "validating" | "passed" | "warning" | "failed";

export type MigrationPilotUploadedFile = {
  fileId: string;
  filename: string;
  category: string;
  sizeBytes?: number;
};

export type MigrationPilotValidationSummary = MigrationValidationSummary & {
  capturedAt: string;
  stageId?: string;
};

export type MigrationPilotDryRunSummary = {
  stageId?: string;
  stageCreated: boolean;
  sourceSystem: string;
  canApply: boolean;
  validationErrors: number;
  validationWarnings: number;
  stagedCounts: {
    learners: number;
    parents: number;
    billingAccounts: number;
    transactions: number;
    staff: number;
    historical: number;
  };
  transactionReadiness: {
    historicalOnlyTransactions: number;
    eligibleActiveTransactions: number;
    blockedTransactions: number;
    unmatchedTransactions: number;
  };
  dryRunWarnings: string[];
  headCountProtected: boolean;
  historicalLearnersProtected: boolean;
};

export type MigrationPilotReconciliationSummary = {
  run: boolean;
  batchId?: string;
  stageId?: string;
  overallStatus?: MigrationReconciliationStatus;
  passed: number;
  warnings: number;
  failed: number;
  total: number;
  headCountProtected: boolean;
  historicalLearnersProtected: boolean;
  reconciledAt?: string;
  messages: string[];
};

export type MigrationPilotRun = {
  pilotId: string;
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  createdAt: string;
  status: MigrationPilotStatus;
  uploadedFiles: MigrationPilotUploadedFile[];
  validationSummary: MigrationPilotValidationSummary;
  dryRunSummary: MigrationPilotDryRunSummary;
  reconciliationSummary: MigrationPilotReconciliationSummary;
  notes: string;
};

export type MigrationPilotVerificationCheck = {
  key: string;
  label: string;
  advisory: boolean;
  satisfied: boolean;
  hint?: string;
};

export type MigrationPilotCreateInput = {
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  uploadedFiles: MigrationPilotUploadedFile[];
  notes?: string;
  stageId?: string;
  batchId?: string;
  validationSummary?: Partial<MigrationPilotValidationSummary>;
  dryRunSummary?: Partial<MigrationPilotDryRunSummary>;
  reconciliationSummary?: Partial<MigrationPilotReconciliationSummary>;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
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

export async function createUniversalMigrationPilot(
  input: MigrationPilotCreateInput
): Promise<{
  pilot: MigrationPilotRun;
  verificationChecks: MigrationPilotVerificationCheck[];
  statusReasons: string[];
}> {
  const res = await fetch(`${API_URL}/api/migration/pilots`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{
    success?: boolean;
    pilot?: MigrationPilotRun;
    verificationChecks?: MigrationPilotVerificationCheck[];
    statusReasons?: string[];
    error?: string;
  }>(res);
  if (!res.ok || !data.pilot) {
    throw new Error(data.error || `Pilot record creation failed (${res.status})`);
  }
  return {
    pilot: data.pilot,
    verificationChecks: data.verificationChecks ?? [],
    statusReasons: data.statusReasons ?? [],
  };
}

export async function fetchUniversalMigrationPilots(): Promise<MigrationPilotRun[]> {
  const res = await fetch(`${API_URL}/api/migration/pilots`, { headers: authHeaders() });
  const data = await parseJsonResponse<{ success?: boolean; pilots?: MigrationPilotRun[]; error?: string }>(
    res
  );
  if (!res.ok) throw new Error(data.error || `Failed to list pilots (${res.status})`);
  return data.pilots ?? [];
}

export async function fetchUniversalMigrationPilot(pilotId: string): Promise<{
  pilot: MigrationPilotRun;
  verificationChecks: MigrationPilotVerificationCheck[];
}> {
  const res = await fetch(`${API_URL}/api/migration/pilots/${encodeURIComponent(pilotId)}`, {
    headers: authHeaders(),
  });
  const data = await parseJsonResponse<{
    success?: boolean;
    pilot?: MigrationPilotRun;
    verificationChecks?: MigrationPilotVerificationCheck[];
    error?: string;
  }>(res);
  if (!res.ok || !data.pilot) {
    throw new Error(data.error || `Failed to load pilot (${res.status})`);
  }
  return {
    pilot: data.pilot,
    verificationChecks: data.verificationChecks ?? [],
  };
}

export function pilotStatusLabel(status: MigrationPilotStatus): string {
  if (status === "passed") return "Passed";
  if (status === "warning") return "Warning";
  if (status === "failed") return "Failed";
  if (status === "validating") return "Validating";
  return "Draft";
}
