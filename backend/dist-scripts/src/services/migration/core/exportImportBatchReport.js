"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportImportBatchReport = exportImportBatchReport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const migrationImportBatchStore_1 = require("./migrationImportBatchStore");
const migrationReportCsv_1 = require("./migrationReportCsv");
const exportValidationReport_1 = require("./exportValidationReport");
const REPORTS_DIR = path_1.default.join(process.cwd(), "storage", "migration-reports");
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
const INCLUDED_STATUSES = new Set([
    "created",
    "skipped",
    "failed",
    "not_applied",
]);
function timestampForFilename(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
}
function formatSourceRow(row) {
    const file = row.sourceFilename?.trim() || row.sourceFileId || "";
    const rowNum = row.rowNumber > 0 ? String(row.rowNumber) : "";
    if (file && rowNum)
        return `${file} #${rowNum}`;
    return file || rowNum || "";
}
function exportImportBatchReport(batchId) {
    const batch = (0, migrationImportBatchStore_1.getImportBatch)(batchId);
    if (!batch) {
        throw new Error("Import batch not found");
    }
    (0, exportValidationReport_1.ensureMigrationReportsDir)();
    const school = batch.targetSchoolName || batch.targetSchoolId || "";
    const reportRows = (batch.reportRows ?? []).filter((row) => INCLUDED_STATUSES.has(row.status));
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
    const csv = (0, migrationReportCsv_1.buildCsvContent)(HEADERS, rows);
    const safeBatch = batchId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const filename = `import-batch-${safeBatch}-${timestampForFilename()}.csv`;
    const absolutePath = path_1.default.join(REPORTS_DIR, filename);
    const tmpPath = `${absolutePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, csv, "utf8");
    fs_1.default.renameSync(tmpPath, absolutePath);
    return {
        success: true,
        downloadPath: `/api/migration/reports/${filename}`,
        filename,
        absolutePath,
        rowCount: rows.length,
        batchId: batch.batchId,
    };
}
