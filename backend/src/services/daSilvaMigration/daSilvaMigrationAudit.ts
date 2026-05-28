import fs from "fs";
import path from "path";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");

export type DaSilvaMigrationAuditReport = {
  strategy: string;
  phase: string;
  generatedAt: string;
  schoolId: string;
  projectId: string;
  passed: boolean;
  summary: Record<string, number | string | boolean>;
  unmatchedLearners: Array<Record<string, unknown>>;
  unmatchedParents: Array<Record<string, unknown>>;
  duplicateMatches: Array<Record<string, unknown>>;
  billingAccountsNotMatched: Array<Record<string, unknown>>;
  billingReconciliation?: Record<string, unknown>;
  errors: string[];
};

export function auditReportPath(schoolId: string, projectId: string, phase: string): string {
  return path.join(STAGING_ROOT, schoolId, `dasilva-${projectId}.audit-${phase}.json`);
}

export function writeDaSilvaMigrationAudit(
  schoolId: string,
  projectId: string,
  report: DaSilvaMigrationAuditReport
): string {
  const file = auditReportPath(schoolId, projectId, report.phase);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

export function loadDaSilvaMigrationAudit(
  schoolId: string,
  projectId: string,
  phase: string
): DaSilvaMigrationAuditReport | null {
  const file = auditReportPath(schoolId, projectId, phase);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as DaSilvaMigrationAuditReport;
}
