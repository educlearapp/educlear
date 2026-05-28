import fs from "fs";
import path from "path";
import type { MigrationReconciliationResult } from "../types/MigrationReconciliation";
import { buildCsvContent } from "./migrationReportCsv";
import { ensureMigrationReportsDir } from "./exportValidationReport";

const REPORTS_DIR = path.join(process.cwd(), "storage", "migration-reports");

const HEADERS = ["Check", "Expected", "Actual", "Status", "Message"];

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export type ExportMigrationReconciliationReportResult = {
  success: true;
  downloadPath: string;
  filename: string;
  absolutePath: string;
  rowCount: number;
  batchId: string;
};

export function exportMigrationReconciliationReport(
  reconciliation: MigrationReconciliationResult
): ExportMigrationReconciliationReportResult {
  ensureMigrationReportsDir();

  const rows = reconciliation.checks.map((c) => [
    c.check,
    c.expected,
    c.actual,
    c.status.toUpperCase(),
    c.message,
  ]);

  const csv = buildCsvContent(HEADERS, rows);
  const safeBatch = reconciliation.batchId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const filename = `reconciliation-${safeBatch}-${timestampForFilename()}.csv`;
  const absolutePath = path.join(REPORTS_DIR, filename);
  const tmpPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, csv, "utf8");
  fs.renameSync(tmpPath, absolutePath);

  return {
    success: true,
    downloadPath: `/api/migration/reports/${filename}`,
    filename,
    absolutePath,
    rowCount: rows.length,
    batchId: reconciliation.batchId,
  };
}
