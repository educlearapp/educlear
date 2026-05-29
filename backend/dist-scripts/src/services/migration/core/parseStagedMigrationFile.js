"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSafeMigrationFilePath = resolveSafeMigrationFilePath;
exports.parseStagedMigrationFile = parseStagedMigrationFile;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const migrationLearnerFileParser_1 = require("../../../utils/migrationLearnerFileParser");
const kideesysReportTableExtraction_1 = require("../adapters/kideesysReportTableExtraction");
const migrationStagingPath_1 = require("./migrationStagingPath");
const migrationProjectPaths_1 = require("../migrationProjectPaths");
function resolveSafeMigrationFilePath(filePath) {
    try {
        return (0, migrationProjectPaths_1.resolveSafeMigrationReadPath)(filePath);
    }
    catch {
        const stagingRoot = path_1.default.resolve((0, migrationStagingPath_1.getUniversalMigrationStagingDir)());
        const resolved = path_1.default.resolve(String(filePath || ""));
        if (!resolved.startsWith(stagingRoot + path_1.default.sep) && resolved !== stagingRoot) {
            throw new Error("Stage file path is outside migration staging");
        }
        return resolved;
    }
}
/**
 * Parse a staged migration upload (CSV/XLS/XLSX) using the same Kid-e-Sys report
 * extraction as dry-run preview — required for contact_list and class lists.
 */
async function parseStagedMigrationFile(filePath, filename, sourceSystem) {
    const absolutePath = resolveSafeMigrationFilePath(filePath);
    const stat = await promises_1.default.stat(absolutePath);
    if (!stat.isFile() || stat.size === 0) {
        throw new Error(`Staged file "${filename}" is missing or empty`);
    }
    const buffer = await promises_1.default.readFile(absolutePath);
    let parsed = null;
    if ((0, kideesysReportTableExtraction_1.shouldUseKideesysReportExtraction)(filename, sourceSystem)) {
        const matrix = (0, migrationLearnerFileParser_1.readMigrationSpreadsheetMatrix)(buffer, filename);
        const extracted = (0, kideesysReportTableExtraction_1.extractKideesysReportTable)(matrix, filename);
        if (extracted) {
            parsed = extracted;
        }
    }
    if (!parsed) {
        parsed = (0, migrationLearnerFileParser_1.parseMigrationLearnerFileBuffer)(buffer, filename);
    }
    return parsed.rows;
}
