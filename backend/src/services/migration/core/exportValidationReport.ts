import fs from "fs";
import path from "path";
import type {
  MigrationValidationIssue,
  MigrationValidationSummary,
} from "../types/MigrationValidation";
import { buildCsvContent } from "./migrationReportCsv";

const REPORTS_DIR = path.join(process.cwd(), "storage", "migration-reports");

const HEADERS = [
  "File",
  "Row",
  "Severity",
  "Category",
  "Field",
  "Message",
  "Value",
];

export function ensureMigrationReportsDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export type ExportValidationReportInput = {
  summary?: MigrationValidationSummary;
  issues: MigrationValidationIssue[];
};

export type ExportValidationReportResult = {
  success: true;
  downloadPath: string;
  filename: string;
  absolutePath: string;
  rowCount: number;
};

export function exportValidationReport(
  input: ExportValidationReportInput
): ExportValidationReportResult {
  ensureMigrationReportsDir();

  const issues = Array.isArray(input.issues) ? input.issues : [];
  void input.summary;

  const rows = issues.map((issue) => [
    issue.filename || issue.fileId || "",
    String(issue.rowNumber ?? ""),
    issue.severity || "",
    issue.category || "",
    issue.field || "",
    issue.message || "",
    issue.value || "",
  ]);

  const csv = buildCsvContent(HEADERS, rows);
  const filename = `validation-export-${timestampForFilename()}.csv`;
  const absolutePath = path.join(REPORTS_DIR, filename);
  const tmpPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, csv, "utf8");
  fs.renameSync(tmpPath, absolutePath);

  return {
    success: true,
    downloadPath: `/api/migration/reports/${filename}`,
    filename,
    absolutePath,
    rowCount: issues.length,
  };
}

export function resolveMigrationReportPath(filename: string): string | null {
  const trimmed = String(filename || "").trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  if (!/^[a-zA-Z0-9._-]+\.csv$/.test(trimmed)) return null;
  const resolved = path.resolve(REPORTS_DIR, trimmed);
  if (!resolved.startsWith(path.resolve(REPORTS_DIR) + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
