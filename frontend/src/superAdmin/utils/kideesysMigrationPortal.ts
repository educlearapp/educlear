import { superAdminApiFetch, superAdminApiUpload } from "../superAdminApi";
import type {
  KideesysPostImportReport,
  KideesysValidationResult,
} from "../types/kideesysMigrationPortal";

const BASE = "/api/super-admin/migration/kideesys";

export async function createKideesysProject(schoolId: string): Promise<string> {
  const res = (await superAdminApiFetch(`${BASE}/projects`, {
    method: "POST",
    body: JSON.stringify({ schoolId }),
  })) as { projectId: string };
  return res.projectId;
}

export async function validateKideesysUpload(opts: {
  schoolId: string;
  projectId: string;
  files: File[];
  onProgress?: (percent: number) => void;
}): Promise<KideesysValidationResult> {
  const form = new FormData();
  form.append("schoolId", opts.schoolId);
  form.append("projectId", opts.projectId);
  for (const file of opts.files) {
    form.append("files", file, file.name);
  }
  return (await superAdminApiUpload(`${BASE}/validate`, form, opts.onProgress)) as KideesysValidationResult;
}

export async function approveKideesysImport(opts: {
  schoolId: string;
  projectId: string;
  confirmToken: string;
}): Promise<void> {
  await superAdminApiFetch(`${BASE}/approve`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function applyKideesysImport(opts: {
  schoolId: string;
  projectId: string;
  confirmToken: string;
}): Promise<{ imported: Record<string, number>; report: KideesysPostImportReport }> {
  return (await superAdminApiFetch(`${BASE}/apply`, {
    method: "POST",
    body: JSON.stringify(opts),
  })) as { imported: Record<string, number>; report: KideesysPostImportReport };
}

export async function purgeSchoolForReimport(schoolId: string): Promise<Record<string, unknown>> {
  return (await superAdminApiFetch(`${BASE}/purge`, {
    method: "POST",
    body: JSON.stringify({ schoolId, confirm: true }),
  })) as Record<string, unknown>;
}

export async function rollbackKideesysImport(
  schoolId: string,
  projectId: string
): Promise<Record<string, unknown>> {
  return (await superAdminApiFetch(`${BASE}/rollback`, {
    method: "POST",
    body: JSON.stringify({ schoolId, projectId }),
  })) as Record<string, unknown>;
}

export async function fetchKideesysPostImportReport(
  schoolId: string,
  projectId: string
): Promise<KideesysPostImportReport | null> {
  try {
    const res = (await superAdminApiFetch(
      `${BASE}/report/${projectId}?schoolId=${encodeURIComponent(schoolId)}`
    )) as { report: KideesysPostImportReport };
    return res.report;
  } catch {
    return null;
  }
}

export function formatKideesysSummary(result: KideesysValidationResult): string {
  const lines = [
    `Active learners (class lists): ${result.activeLearnerCount}`,
    `Historical / unenrolled: ${result.historicalLearnerCount}`,
    `Billing accounts (age analysis): ${result.countValidation.billingAccountsFromAgeAnalysis}`,
    `Balance variances: ${result.balanceValidation.varianceCount}`,
    `Can apply: ${result.canApply ? "yes" : "no — fix blocking errors first"}`,
  ];
  if (result.summary) {
    lines.push(
      `Transactions — invoices: ${result.summary.totalInvoices}, payments: ${result.summary.totalPayments}`,
      `Outstanding (age analysis total): R${Number(result.summary.totalOutstandingBalance || 0).toFixed(2)}`
    );
  }
  return lines.join("\n");
}
