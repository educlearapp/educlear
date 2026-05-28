import fs from "fs";
import path from "path";
import type { MigrationImportReportRow } from "../types/MigrationApply";
import { getImportBatch } from "./migrationImportBatchStore";
import { buildCsvContent } from "./migrationReportCsv";
import { ensureMigrationReportsDir } from "./exportValidationReport";

const REPORTS_DIR = path.join(process.cwd(), "storage", "migration-reports");

const HEADERS = [
  "Batch ID",
  "Entity Type",
  "Status",
  "School",
  "Source Row",
  "Message",
  "Created Record ID",
  "Details",
];

const INCLUDED_STATUSES = new Set<MigrationImportReportRow["status"]>([
  "created",
  "skipped",
  "failed",
  "not_applied",
]);

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function formatSourceRow(row: MigrationImportReportRow): string {
  const file = row.sourceFilename?.trim() || row.sourceFileId || "";
  const rowNum = row.rowNumber > 0 ? String(row.rowNumber) : "";
  if (file && rowNum) return `${file} #${rowNum}`;
  return file || rowNum || "";
}

export type ExportImportBatchReportResult = {
  success: true;
  downloadPath: string;
  filename: string;
  absolutePath: string;
  rowCount: number;
  batchId: string;
};

export function exportImportBatchReport(batchId: string): ExportImportBatchReportResult {
  const batch = getImportBatch(batchId);
  if (!batch) {
    throw new Error("Import batch not found");
  }

  ensureMigrationReportsDir();

  const school = batch.targetSchoolName || batch.targetSchoolId || "";
  const reportRows = (batch.reportRows ?? []).filter((row) =>
    INCLUDED_STATUSES.has(row.status)
  );

  const rows = reportRows.map((row) => [
    batch.batchId,
    row.entityType,
    row.status,
    school,
    formatSourceRow(row),
    row.message || "",
    row.recordId || "",
    row.key || "",
  ]);

  const csv = buildCsvContent(HEADERS, rows);
  const safeBatch = batchId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const filename = `import-batch-${safeBatch}-${timestampForFilename()}.csv`;
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
    batchId: batch.batchId,
  };
}
