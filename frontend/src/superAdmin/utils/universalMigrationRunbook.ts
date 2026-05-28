import { API_URL } from "../../api";

export type MigrationRunbookStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

export type MigrationRunbookOverallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

export type MigrationRunbookStep = {
  stepId: string;
  title: string;
  description: string;
  status: MigrationRunbookStepStatus;
  required: boolean;
  notes: string;
};

export type MigrationRunbook = {
  runbookId: string;
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  createdAt: string;
  steps: MigrationRunbookStep[];
  overallStatus: MigrationRunbookOverallStatus;
  pilotId: string;
  notes: string;
};

export type MigrationRunbookCreateInput = {
  schoolId: string;
  schoolName: string;
  sourceSystem?: string;
  pilotId?: string;
  notes?: string;
};

export type MigrationRunbookStepPatch = {
  stepId: string;
  status?: MigrationRunbookStepStatus;
  notes?: string;
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

export async function createUniversalMigrationRunbook(
  input: MigrationRunbookCreateInput
): Promise<MigrationRunbook> {
  const res = await fetch(`${API_URL}/api/migration/runbooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ success?: boolean; runbook?: MigrationRunbook; error?: string }>(
    res
  );
  if (!res.ok || !data.runbook) {
    throw new Error(data.error || `Runbook creation failed (${res.status})`);
  }
  return data.runbook;
}

export async function fetchUniversalMigrationRunbooks(): Promise<MigrationRunbook[]> {
  const res = await fetch(`${API_URL}/api/migration/runbooks`, { headers: authHeaders() });
  const data = await parseJsonResponse<{ success?: boolean; runbooks?: MigrationRunbook[]; error?: string }>(
    res
  );
  if (!res.ok) throw new Error(data.error || `Failed to list runbooks (${res.status})`);
  return data.runbooks ?? [];
}

export async function fetchUniversalMigrationRunbook(runbookId: string): Promise<MigrationRunbook> {
  const res = await fetch(`${API_URL}/api/migration/runbooks/${encodeURIComponent(runbookId)}`, {
    headers: authHeaders(),
  });
  const data = await parseJsonResponse<{ success?: boolean; runbook?: MigrationRunbook; error?: string }>(
    res
  );
  if (!res.ok || !data.runbook) {
    throw new Error(data.error || `Failed to load runbook (${res.status})`);
  }
  return data.runbook;
}

export async function patchUniversalMigrationRunbook(
  runbookId: string,
  patch: {
    steps?: MigrationRunbookStepPatch[];
    notes?: string;
    pilotId?: string | null;
  }
): Promise<MigrationRunbook> {
  const res = await fetch(`${API_URL}/api/migration/runbooks/${encodeURIComponent(runbookId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(patch),
  });
  const data = await parseJsonResponse<{ success?: boolean; runbook?: MigrationRunbook; error?: string }>(
    res
  );
  if (!res.ok || !data.runbook) {
    throw new Error(data.error || `Failed to update runbook (${res.status})`);
  }
  return data.runbook;
}

export function runbookOverallStatusLabel(status: MigrationRunbookOverallStatus): string {
  if (status === "completed") return "Completed";
  if (status === "blocked") return "Blocked";
  if (status === "in_progress") return "In progress";
  return "Pending";
}

export function runbookStepStatusLabel(status: MigrationRunbookStepStatus): string {
  if (status === "completed") return "Completed";
  if (status === "blocked") return "Blocked";
  if (status === "in_progress") return "In progress";
  return "Pending";
}
