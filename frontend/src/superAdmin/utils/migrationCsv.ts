/** Minimal CSV parser for migration uploads (no external deps). */

import { superAdminApiFetch } from "../superAdminApi";

const LEARNER_FILE_EXTENSIONS = [".csv", ".xls", ".xlsx"];

export function isLearnerMigrationFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return LEARNER_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => !c.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }

  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export async function readMigrationFiles(
  files: File[]
): Promise<{ headers: string[]; rows: Record<string, string>[]; fileName: string }> {
  const learnerFiles = files.filter(isLearnerMigrationFile);
  if (!learnerFiles.length) {
    throw new Error("Upload at least one learner file (CSV, XLS, or XLSX).");
  }

  const primary = learnerFiles[0];
  const lower = primary.name.toLowerCase();

  if (lower.endsWith(".csv")) {
    const text = await primary.text();
    const parsed = parseCsvText(text);
    return { ...parsed, fileName: primary.name };
  }

  const form = new FormData();
  form.append("file", primary, primary.name);
  const data = (await superAdminApiFetch("/api/super-admin/migration/parse-learner-file", {
    method: "POST",
    body: form,
  })) as {
    headers: string[];
    rows: Record<string, string>[];
    fileName?: string;
  };

  return {
    headers: data.headers || [],
    rows: data.rows || [],
    fileName: data.fileName || primary.name,
  };
}

export function formatValidationReportSummary(report: {
  rowCount: number;
  blockingErrorCount: number;
  warningCount: number;
  duplicateClassrooms: { length: number } | unknown[];
  duplicateLearners: { length: number } | unknown[];
  missingParents: { length: number } | unknown[];
  teacherAssignmentWarnings: { length: number } | unknown[];
  normalizationPreview: { length: number } | unknown[];
  canImport: boolean;
}): string {
  const dupClass = Array.isArray(report.duplicateClassrooms)
    ? report.duplicateClassrooms.length
    : 0;
  const dupLearner = Array.isArray(report.duplicateLearners)
    ? report.duplicateLearners.length
    : 0;
  const missingParents = Array.isArray(report.missingParents)
    ? report.missingParents.length
    : 0;
  const teacherWarn = Array.isArray(report.teacherAssignmentWarnings)
    ? report.teacherAssignmentWarnings.length
    : 0;
  const normRows = Array.isArray(report.normalizationPreview)
    ? report.normalizationPreview.length
    : 0;

  return [
    `Rows: ${report.rowCount}`,
    `Blocking errors: ${report.blockingErrorCount}`,
    `Warnings: ${report.warningCount}`,
    `Duplicate classrooms (normalized): ${dupClass}`,
    `Duplicate learners in file: ${dupLearner}`,
    `Missing parent contact: ${missingParents}`,
    `Teacher assignment conflicts: ${teacherWarn}`,
    `Classrooms after normalization: ${normRows}`,
    report.canImport
      ? "Ready for staging import."
      : "Fix blocking errors before staging or final import.",
  ].join("\n");
}
