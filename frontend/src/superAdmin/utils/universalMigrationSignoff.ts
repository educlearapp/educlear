import { API_URL } from "../../api";
import type { MigrationApplyCounts } from "./universalMigrationApply";
import type { MigrationReconciliationStatus } from "./universalMigrationImportBatches";

export type MigrationSignoffStatus = "draft" | "approved" | "blocked";

export type MigrationSignoffCounts = {
  created: MigrationApplyCounts;
  skipped: MigrationApplyCounts;
  failed: MigrationApplyCounts;
};

export type MigrationExportedReport = {
  label: string;
  filename: string;
  downloadPath: string;
};

export type MigrationSignoffPack = {
  signoffId: string;
  batchId: string;
  stageId: string;
  schoolId: string;
  schoolName: string;
  operatorName: string;
  operatorEmail: string;
  createdAt: string;
  signoffStatus: MigrationSignoffStatus;
  reconciliationStatus: MigrationReconciliationStatus;
  migrationStatus: string;
  counts: MigrationSignoffCounts;
  warnings: string[];
  exportedReports: MigrationExportedReport[];
  notes: string;
  approvedForGoLive: boolean;
  approvalConfirmed: boolean;
  reconciledAt: string;
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

export async function createUniversalMigrationSignoff(input: {
  batchId: string;
  targetSchoolId: string;
  operatorName: string;
  operatorEmail: string;
  notes?: string;
  approvalConfirmed: boolean;
}): Promise<MigrationSignoffPack> {
  const res = await fetch(
    `${API_URL}/api/migration/import-batches/${encodeURIComponent(input.batchId)}/signoff`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        targetSchoolId: input.targetSchoolId,
        operatorName: input.operatorName,
        operatorEmail: input.operatorEmail,
        notes: input.notes ?? "",
        approvalConfirmed: input.approvalConfirmed,
      }),
    }
  );
  const data = await parseJsonResponse<{
    success?: boolean;
    signoff?: MigrationSignoffPack;
    error?: string;
  }>(res);
  if (!res.ok || !data.signoff) {
    throw new Error(data.error || `Sign-off generation failed (${res.status})`);
  }
  return data.signoff;
}

export async function fetchUniversalMigrationSignoffs(): Promise<MigrationSignoffPack[]> {
  const res = await fetch(`${API_URL}/api/migration/signoffs`, { headers: authHeaders() });
  const data = await parseJsonResponse<{ success?: boolean; signoffs?: MigrationSignoffPack[]; error?: string }>(
    res
  );
  if (!res.ok) throw new Error(data.error || `Failed to list sign-offs (${res.status})`);
  return data.signoffs ?? [];
}

export async function downloadUniversalMigrationSignoffFile(downloadPath: string): Promise<void> {
  const url = downloadPath.startsWith("http") ? downloadPath : `${API_URL}${downloadPath}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    let message = `Download failed (${res.status})`;
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const filename = downloadPath.split("/").pop()?.replace(/\?.*$/, "") || "signoff-export";
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
