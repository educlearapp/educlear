"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMigrationFileRows = readMigrationFileRows;
const promises_1 = __importDefault(require("fs/promises"));
const detectMigrationCategory_1 = require("./detectMigrationCategory");
const parseStagedMigrationFile_1 = require("./parseStagedMigrationFile");
function rowRecordsToUnknown(rows) {
    return rows.map((row) => {
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            out[key] = value;
        }
        return out;
    });
}
function buildWarnings(columns, rowCount) {
    const warnings = [];
    if (columns.length === 0) {
        warnings.push("No column headers detected.");
    }
    else if (columns.every((h) => !h.trim())) {
        warnings.push("Header row is empty or unreadable.");
    }
    if (rowCount === 0) {
        warnings.push("File contains no data rows.");
    }
    return warnings;
}
/**
 * Read-only full parse of a staged migration file (CSV, XLS, XLSX).
 * Does not modify the source file or touch the live database.
 */
async function readMigrationFileRows(file, options) {
    const fileId = String(file.id || "").trim();
    const filename = String(file.filename || "").trim() || "upload";
    const category = String(file.category || (0, detectMigrationCategory_1.detectMigrationCategory)(filename));
    const absolutePath = (0, parseStagedMigrationFile_1.resolveSafeMigrationFilePath)(file.path);
    let stat;
    try {
        stat = await promises_1.default.stat(absolutePath);
    }
    catch {
        return {
            fileId,
            filename,
            category,
            columns: [],
            rows: [],
            rowCount: 0,
            warnings: ["File not found on disk. Re-upload to refresh."],
            parseIssues: [],
        };
    }
    if (!stat.isFile() || stat.size === 0) {
        return {
            fileId,
            filename,
            category,
            columns: [],
            rows: [],
            rowCount: 0,
            warnings: ["File is empty."],
            parseIssues: [],
        };
    }
    let columns = [];
    let rowCount = 0;
    let rows = [];
    let parseIssues = [];
    try {
        const sourceSystem = String(options?.sourceSystem || "").trim();
        const parsedRows = await (0, parseStagedMigrationFile_1.parseStagedMigrationFile)(absolutePath, filename, sourceSystem);
        rowCount = parsedRows.length;
        rows = rowRecordsToUnknown(parsedRows);
        columns =
            parsedRows.length > 0
                ? Object.keys(parsedRows[0]).filter((k) => String(k).trim())
                : [];
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to parse file";
        return {
            fileId,
            filename,
            category,
            columns: [],
            rows: [],
            rowCount: 0,
            warnings: [message],
            parseIssues: [],
        };
    }
    const warnings = buildWarnings(columns, rowCount);
    for (const pi of parseIssues) {
        warnings.push(pi.message);
    }
    const leaf = filename.split(/[/\\]/).pop() || filename;
    const basename = leaf.replace(/\.[^.]+$/i, "");
    const haystack = filename.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (category === "learners" &&
        columns.includes("fullName") &&
        rowCount > 0 &&
        (0, detectMigrationCategory_1.isLearnerClassExportFilename)(haystack, basename)) {
        const classroom = columns.includes("classroom")
            ? String(rows[0]?.classroom ?? "").trim()
            : "";
        warnings.push(classroom
            ? `Kid-e-Sys class list (${classroom}, ${rowCount} learner(s)).`
            : `Kid-e-Sys class list (${rowCount} learner(s)).`);
    }
    if (category === "parents" &&
        rowCount > 0 &&
        columns.includes("Parent Name") &&
        columns.includes("Learner Name") &&
        haystack.includes("contactlist")) {
        const classroom = columns.includes("Classroom")
            ? String(rows[0]?.Classroom ?? "").trim()
            : "";
        warnings.push(classroom
            ? `Kid-e-Sys contact list (${classroom}, ${rowCount} parent contact row(s)).`
            : `Kid-e-Sys contact list (${rowCount} parent contact row(s)).`);
    }
    return {
        fileId,
        filename,
        category,
        columns,
        rows,
        rowCount,
        warnings,
        parseIssues,
    };
}
