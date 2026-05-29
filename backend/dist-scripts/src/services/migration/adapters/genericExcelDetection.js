"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGenericSpreadsheetFilename = isGenericSpreadsheetFilename;
exports.evaluateGenericExcelDetection = evaluateGenericExcelDetection;
exports.detectGenericExcelExports = detectGenericExcelExports;
const kideesysDetection_1 = require("./kideesysDetection");
const sasamsDetection_1 = require("./sasamsDetection");
const genericExcelNormalization_1 = require("./genericExcelNormalization");
const genericExcelMetadata_1 = require("./genericExcelMetadata");
function compactKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
function isGenericSpreadsheetFilename(filename) {
    const lower = String(filename || "").trim().toLowerCase();
    return genericExcelMetadata_1.GENERIC_EXCEL_SUPPORTED_FILE_TYPES.some((ext) => lower.endsWith(`.${ext}`));
}
function hasReadableHeaders(columns) {
    return columns.map((c) => String(c || "").trim()).filter(Boolean).length > 0;
}
function isStronglyKnownNonGenericSystem(input) {
    const kid = (0, kideesysDetection_1.evaluateKidESysDetection)({
        filenames: input.filenames,
        columns: input.columns,
    });
    if (kid.detected)
        return true;
    const sasams = (0, sasamsDetection_1.evaluateSASAMSDetection)({
        filenames: input.filenames,
        columns: input.columns,
    });
    return sasams.detected;
}
function evaluateGenericExcelDetection(input) {
    const filenames = (input.filenames || []).map((f) => String(f).trim()).filter(Boolean);
    const columns = (input.columns || []).map((c) => String(c).trim()).filter(Boolean);
    const requireReadableStructure = input.requireReadableStructure !== false;
    const spreadsheetFiles = filenames.filter(isGenericSpreadsheetFilename);
    const spreadsheetFileCount = spreadsheetFiles.length;
    const hasSpreadsheet = spreadsheetFileCount > 0;
    const headerCount = columns.length;
    const headersReadable = hasReadableHeaders(columns);
    const headerGroupsMatched = headersReadable ? (0, genericExcelNormalization_1.countGenericExcelHeaderGroups)(columns) : 0;
    const normalizationRatio = headersReadable ? (0, genericExcelNormalization_1.genericExcelNormalizationConfidence)(columns) : 0;
    const excludedByKnownSystem = isStronglyKnownNonGenericSystem({ filenames, columns });
    const rules = genericExcelMetadata_1.GENERIC_EXCEL_CONFIDENCE_RULES;
    let detected = false;
    let reason;
    if (!hasSpreadsheet) {
        reason = "No CSV/XLS/XLSX filenames in upload set.";
    }
    else if (excludedByKnownSystem) {
        reason =
            "Files match a known system export (e.g. Kid-e-Sys, SA-SAMS) — use that adapter instead of generic fallback.";
    }
    else if (filenames.length > spreadsheetFileCount) {
        reason = "Mixed file types — generic adapter expects CSV/XLS/XLSX only.";
    }
    else if (requireReadableStructure && !headersReadable) {
        reason = "Spreadsheet extension detected but column headers are not available yet — load previews first.";
    }
    else if (requireReadableStructure && headerGroupsMatched < rules.minHeaderGroups) {
        reason = `Readable headers but no learner/parent/billing/transaction field groups recognised (${headerGroupsMatched} group(s)).`;
    }
    else if (requireReadableStructure &&
        normalizationRatio < rules.minNormalizedColumnRatio) {
        reason = `Low column recognition (${Math.round(normalizationRatio * 100)}%) — verify header row or map manually.`;
    }
    else if (!requireReadableStructure) {
        reason = "Spreadsheet filenames only — load previews to confirm readable structure.";
    }
    else {
        detected = true;
        reason = `Generic spreadsheet: ${spreadsheetFileCount} file(s), ${headerGroupsMatched} header group(s), ${Math.round(normalizationRatio * 100)}% columns recognised.`;
    }
    return {
        detected,
        spreadsheetFileCount,
        headerCount,
        headerGroupsMatched,
        normalizationRatio,
        excludedByKnownSystem,
        reason,
    };
}
/** Conservative detect — returns false when structure is unreadable or another system is likely. */
function detectGenericExcelExports(filenames, columns) {
    const cols = columns ?? [];
    const requireReadableStructure = cols.length > 0;
    return evaluateGenericExcelDetection({
        filenames,
        columns: cols,
        requireReadableStructure,
    }).detected;
}
