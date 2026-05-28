import { API_URL } from "../../api";

export type MigrationPreflightStatus = "ready" | "warning" | "blocked" | "unknown";

export type MigrationPreflightBlockerSeverity = "critical" | "warning" | "info";

export type MigrationPreflightBlocker = {
  blockerId: string;
  title: string;
  severity: MigrationPreflightBlockerSeverity;
  message: string;
};

export type MigrationPreflightSummary = {
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  overallStatus: MigrationPreflightStatus;
  runbookStatus: string;
  pilotStatus: string;
  validationStatus: string;
  dryRunStatus: string;
  batchStatus: string;
  reconciliationStatus: string;
  signoffStatus: string;
  blockers: MigrationPreflightBlocker[];
  goLiveReady: boolean;
  generatedAt: string;
  runbookId?: string;
  pilotId?: string;
  stageId?: string;
  batchId?: string;
  signoffId?: string;
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

export async function fetchUniversalMigrationPreflight(
  schoolId: string
): Promise<MigrationPreflightSummary> {
  const res = await fetch(
    `${API_URL}/api/migration/preflight/${encodeURIComponent(schoolId)}`,
    { headers: authHeaders() }
  );
  const data = await parseJsonResponse<{ success?: boolean; error?: string; dashboard?: MigrationPreflightSummary }>(
    res
  );
  if (!res.ok) {
    throw new Error(data.error || `Preflight dashboard failed (${res.status})`);
  }
  if (!data.dashboard) {
    throw new Error("Preflight dashboard response missing dashboard");
  }
  return data.dashboard;
}

export function preflightStatusLabel(status: MigrationPreflightStatus): string {
  if (status === "ready") return "READY";
  if (status === "warning") return "WARNING";
  if (status === "blocked") return "BLOCKED";
  return "UNKNOWN";
}
