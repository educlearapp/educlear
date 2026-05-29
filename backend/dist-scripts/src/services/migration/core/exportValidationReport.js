"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMigrationReportsDir = ensureMigrationReportsDir;
exports.exportValidationReport = exportValidationReport;
exports.resolveMigrationReportPath = resolveMigrationReportPath;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const migrationReportCsv_1 = require("./migrationReportCsv");
const REPORTS_DIR = path_1.default.join(process.cwd(), "storage", "migration-reports");
const HEADERS = [
    "File",
    "Row",
    "Severity",
    "Category",
    "Field",
    "Message",
    "Value",
];
function ensureMigrationReportsDir() {
    if (!fs_1.default.existsSync(REPORTS_DIR)) {
        fs_1.default.mkdirSync(REPORTS_DIR, { recursive: true });
    }
}
function timestampForFilename(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
}
function exportValidationReport(input) {
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
    const csv = (0, migrationReportCsv_1.buildCsvContent)(HEADERS, rows);
    const filename = `validation-export-${timestampForFilename()}.csv`;
    const absolutePath = path_1.default.join(REPORTS_DIR, filename);
    const tmpPath = `${absolutePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, csv, "utf8");
    fs_1.default.renameSync(tmpPath, absolutePath);
    return {
        success: true,
        downloadPath: `/api/migration/reports/${filename}`,
        filename,
        absolutePath,
        rowCount: issues.length,
    };
}
function resolveMigrationReportPath(filename) {
    const trimmed = String(filename || "").trim();
    if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
        return null;
    }
    if (!/^[a-zA-Z0-9._-]+\.csv$/.test(trimmed))
        return null;
    const resolved = path_1.default.resolve(REPORTS_DIR, trimmed);
    if (!resolved.startsWith(path_1.default.resolve(REPORTS_DIR) + path_1.default.sep))
        return null;
    if (!fs_1.default.existsSync(resolved))
        return null;
    return resolved;
}
