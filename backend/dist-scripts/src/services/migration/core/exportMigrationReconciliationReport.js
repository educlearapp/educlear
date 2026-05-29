"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportMigrationReconciliationReport = exportMigrationReconciliationReport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const migrationReportCsv_1 = require("./migrationReportCsv");
const exportValidationReport_1 = require("./exportValidationReport");
const REPORTS_DIR = path_1.default.join(process.cwd(), "storage", "migration-reports");
const HEADERS = ["Check", "Expected", "Actual", "Status", "Message"];
function timestampForFilename(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
}
function exportMigrationReconciliationReport(reconciliation) {
    (0, exportValidationReport_1.ensureMigrationReportsDir)();
    const rows = reconciliation.checks.map((c) => [
        c.check,
        c.expected,
        c.actual,
        c.status.toUpperCase(),
        c.message,
    ]);
    const csv = (0, migrationReportCsv_1.buildCsvContent)(HEADERS, rows);
    const safeBatch = reconciliation.batchId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const filename = `reconciliation-${safeBatch}-${timestampForFilename()}.csv`;
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
        batchId: reconciliation.batchId,
    };
}
