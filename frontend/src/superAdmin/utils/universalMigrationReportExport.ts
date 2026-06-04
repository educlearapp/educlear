import { API_URL } from "../../api";
import { getSuperAdminToken } from "../../auth/superAdminSession";
import type {
  MigrationValidationIssue,
  MigrationValidationSummary,
} from "./universalMigrationValidate";

function authHeaders(): Record<string, string> {
  const token = getSuperAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function downloadAuthenticatedCsv(downloadPath: string, fallbackFilename: string): Promise<void> {
  const url = downloadPath.startsWith("http") ? downloadPath : `${API_URL}${downloadPath}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    let message = `Export download failed (${res.status})`;
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename =
    downloadPath.split("/").pop()?.replace(/\?.*$/, "") || fallbackFilename;
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

export async function exportUniversalMigrationValidationReport(input: {
  summary: MigrationValidationSummary | null;
  issues: MigrationValidationIssue[];
}): Promise<string> {
  const res = await fetch(`${API_URL}/api/migration/validation/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      summary: input.summary,
      issues: input.issues,
    }),
  });

  const data = (await res.json()) as {
    success?: boolean;
    downloadPath?: string;
    error?: string;
  };

  if (!res.ok || !data.success || !data.downloadPath) {
    throw new Error(data.error || `Validation export failed (${res.status})`);
  }

  await downloadAuthenticatedCsv(data.downloadPath, "validation-export.csv");
  return data.downloadPath;
}

export async function exportUniversalMigrationImportBatchReport(
  batchId: string
): Promise<string> {
  const res = await fetch(
    `${API_URL}/api/migration/import-batches/${encodeURIComponent(batchId)}/export`,
    { headers: authHeaders() }
  );

  const data = (await res.json()) as {
    success?: boolean;
    downloadPath?: string;
    error?: string;
  };

  if (!res.ok || !data.success || !data.downloadPath) {
    throw new Error(data.error || `Batch export failed (${res.status})`);
  }

  await downloadAuthenticatedCsv(data.downloadPath, `import-batch-${batchId}.csv`);
  return data.downloadPath;
}

export async function exportUniversalMigrationReconciliationReport(
  batchId: string,
  targetSchoolId: string
): Promise<string> {
  const params = new URLSearchParams({ targetSchoolId });
  const res = await fetch(
    `${API_URL}/api/migration/import-batches/${encodeURIComponent(batchId)}/reconciliation/export?${params}`,
    { headers: authHeaders() }
  );

  const data = (await res.json()) as {
    success?: boolean;
    downloadPath?: string;
    error?: string;
  };

  if (!res.ok || !data.success || !data.downloadPath) {
    throw new Error(data.error || `Reconciliation export failed (${res.status})`);
  }

  await downloadAuthenticatedCsv(data.downloadPath, `reconciliation-${batchId}.csv`);
  return data.downloadPath;
}
