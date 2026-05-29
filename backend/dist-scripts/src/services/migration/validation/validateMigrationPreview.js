"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMigrationPreview = validateMigrationPreview;
exports.validateMigrationFull = validateMigrationFull;
exports.validateMigration = validateMigration;
const readMigrationFileRows_1 = require("../core/readMigrationFileRows");
const validateTransactionReadiness_1 = require("./validateTransactionReadiness");
const MAX_ISSUES_SHOWN = 500;
const LEARNER_NAME_FIELDS = ["firstName", "lastName", "fullName"];
const GRADE_CLASS_FIELDS = ["grade", "classroom"];
const NUMERIC_BALANCE_FIELDS = [
    "openingBalance",
    "currentBalance",
    "balance",
];
const NUMERIC_AMOUNT_FIELDS = ["amount", "debit", "credit", "feeAmount"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
/** Loose SA / international phone: digits with optional +, spaces, dashes; at least 9 digits. */
function isValidPhone(raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15)
        return false;
    return /^[\d\s+\-().]+$/.test(raw.trim());
}
/** Temporary: log first parentPhone failure per process (diagnostics only). */
let parentPhoneDiagLogged = false;
function parentPhoneFailureReason(raw) {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 9)
        return `too_few_digits (${digits.length})`;
    if (digits.length > 15)
        return `too_many_digits (${digits.length})`;
    if (!/^[\d\s+\-().]+$/.test(trimmed)) {
        const illegal = [...trimmed].filter((c) => !/[\d\s+\-().]/.test(c));
        const unique = [...new Set(illegal)];
        const detail = unique
            .map((c) => `${JSON.stringify(c)} U+${c.charCodeAt(0).toString(16)}`)
            .join(", ");
        return `illegal_characters: ${detail || "(none)"}`;
    }
    return "unknown";
}
function logParentPhoneDiagnosticOnce(raw, ctx) {
    if (parentPhoneDiagLogged)
        return;
    parentPhoneDiagLogged = true;
    const normalized = cellString(raw);
    const valid = isValidPhone(normalized);
    const reason = valid ? "ok" : parentPhoneFailureReason(normalized);
    console.log("[migration][parentPhone-diagnostic] (first failure only)");
    console.log("RAW:", JSON.stringify(raw));
    console.log("NORMALIZED:", JSON.stringify(normalized));
    console.log("VALID:", valid);
    console.log("REASON:", reason);
    console.log("FILE:", ctx.filename, "ROW:", ctx.rowNumber);
}
function cellString(value) {
    if (value == null)
        return "";
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (value instanceof Date)
        return value.toISOString();
    return String(value).trim();
}
function isEmptyValue(value) {
    return cellString(value).length === 0;
}
function isNumericValue(value) {
    const s = cellString(value);
    if (!s)
        return true;
    const normalized = s.replace(/[\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
    if (normalized === "-" || normalized === "+")
        return false;
    const n = Number(normalized);
    return Number.isFinite(n);
}
function isValidDateValue(value) {
    const s = cellString(value);
    if (!s)
        return true;
    if (/^\d{4,5}(\.\d+)?$/.test(s)) {
        const serial = Number(s);
        if (Number.isFinite(serial) && serial > 20000 && serial < 80000)
            return true;
    }
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed))
        return true;
    const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (dmy) {
        const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
        const month = Number(dmy[2]) - 1;
        const day = Number(dmy[1]);
        const d = new Date(year, month, day);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    }
    return false;
}
function issue(partial) {
    return partial;
}
function buildTargetToSource(mappings) {
    const map = new Map();
    for (const m of mappings) {
        const target = String(m.targetField || "").trim();
        const source = String(m.sourceColumn || "").trim();
        if (target && source)
            map.set(target, source);
    }
    return map;
}
function getMappedValue(row, targetToSource, field) {
    const source = targetToSource.get(field);
    if (!source)
        return undefined;
    return row[source];
}
function buildSummary(issues, mode, rowsChecked, shownCount, truncated) {
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    const info = issues.filter((i) => i.severity === "info").length;
    return {
        mode,
        rowsChecked,
        totalIssues: issues.length,
        errors,
        warnings,
        info,
        canProceed: errors === 0,
        issuesShown: shownCount,
        ...(truncated
            ? {
                issuesTruncated: true,
                truncationMessage: `Showing first ${MAX_ISSUES_SHOWN} of ${issues.length} issues. Fix these and re-validate to see more.`,
            }
            : {}),
    };
}
function applyIssueLimit(issues, mode, rowsChecked) {
    const truncated = issues.length > MAX_ISSUES_SHOWN;
    const shownIssues = truncated ? issues.slice(0, MAX_ISSUES_SHOWN) : issues;
    return {
        summary: buildSummary(issues, mode, rowsChecked, shownIssues.length, truncated),
        issues: shownIssues,
    };
}
function validateFileRows(input) {
    const { preview, fileMappings, rows, fullFile } = input;
    const issues = [];
    const mappings = fileMappings?.mappings ?? [];
    const targetToSource = buildTargetToSource(mappings);
    if (mappings.length === 0) {
        issues.push(issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber: 0,
            severity: "warning",
            category: preview.category,
            field: "mappings",
            message: "No column mappings selected for this file",
            value: "",
        }));
        return issues;
    }
    const mappedSources = new Set(mappings.map((m) => m.sourceColumn));
    const scopeLabel = fullFile ? "file" : "sample";
    for (const sourceColumn of mappedSources) {
        if (rows.length === 0)
            continue;
        const allEmpty = rows.every((row) => isEmptyValue(row[sourceColumn]));
        if (allEmpty) {
            const target = mappings.find((m) => m.sourceColumn === sourceColumn)?.targetField ?? sourceColumn;
            issues.push(issue({
                fileId: preview.fileId,
                filename: preview.filename,
                rowNumber: 0,
                severity: "warning",
                category: preview.category,
                field: String(target),
                message: fullFile
                    ? `Mapped column "${sourceColumn}" is empty in all file rows`
                    : `Mapped column "${sourceColumn}" is empty in all sample rows`,
                value: "",
            }));
        }
    }
    const hasNameMapping = LEARNER_NAME_FIELDS.some((f) => targetToSource.has(f));
    const hasGradeOrClassMapping = GRADE_CLASS_FIELDS.some((f) => targetToSource.has(f));
    const idNumbers = [];
    const accountNumbers = [];
    rows.forEach((row, idx) => {
        const rowNumber = idx + 1;
        if (hasNameMapping) {
            const first = cellString(getMappedValue(row, targetToSource, "firstName"));
            const last = cellString(getMappedValue(row, targetToSource, "lastName"));
            const full = cellString(getMappedValue(row, targetToSource, "fullName"));
            const hasFirst = targetToSource.has("firstName");
            const hasLast = targetToSource.has("lastName");
            const hasFull = targetToSource.has("fullName");
            if (hasFull && !full && !first && !last) {
                issues.push(issue({
                    fileId: preview.fileId,
                    filename: preview.filename,
                    rowNumber,
                    severity: "error",
                    category: preview.category,
                    field: "fullName",
                    message: "Learner name is required but missing",
                    value: "",
                }));
            }
            else if ((hasFirst || hasLast) && !full) {
                if ((hasFirst && !first) || (hasLast && !last)) {
                    issues.push(issue({
                        fileId: preview.fileId,
                        filename: preview.filename,
                        rowNumber,
                        severity: "error",
                        category: preview.category,
                        field: hasFirst && !first ? "firstName" : "lastName",
                        message: "Learner name is required but missing",
                        value: "",
                    }));
                }
            }
        }
        else if (preview.category === "learners" &&
            rows.length > 0 &&
            rowNumber === 1) {
            issues.push(issue({
                fileId: preview.fileId,
                filename: preview.filename,
                rowNumber: 0,
                severity: "info",
                category: preview.category,
                field: "fullName",
                message: "No learner name field mapped (firstName, lastName, or fullName)",
                value: "",
            }));
        }
        if (hasGradeOrClassMapping) {
            for (const field of GRADE_CLASS_FIELDS) {
                if (!targetToSource.has(field))
                    continue;
                const raw = getMappedValue(row, targetToSource, field);
                if (isEmptyValue(raw)) {
                    issues.push(issue({
                        fileId: preview.fileId,
                        filename: preview.filename,
                        rowNumber,
                        severity: "warning",
                        category: preview.category,
                        field,
                        message: `${field === "grade" ? "Grade" : "Classroom"} is mapped but empty on this row`,
                        value: "",
                    }));
                }
            }
        }
        if (targetToSource.has("parentPhone")) {
            const raw = cellString(getMappedValue(row, targetToSource, "parentPhone"));
            if (raw && !isValidPhone(raw)) {
                logParentPhoneDiagnosticOnce(raw, {
                    filename: preview.filename,
                    rowNumber,
                });
                issues.push(issue({
                    fileId: preview.fileId,
                    filename: preview.filename,
                    rowNumber,
                    severity: "error",
                    category: preview.category,
                    field: "parentPhone",
                    message: "Parent phone number is invalid",
                    value: raw,
                }));
            }
        }
        if (targetToSource.has("parentEmail")) {
            const raw = cellString(getMappedValue(row, targetToSource, "parentEmail"));
            if (raw && !EMAIL_RE.test(raw)) {
                issues.push(issue({
                    fileId: preview.fileId,
                    filename: preview.filename,
                    rowNumber,
                    severity: "error",
                    category: preview.category,
                    field: "parentEmail",
                    message: "Parent email address is invalid",
                    value: raw,
                }));
            }
        }
        for (const field of NUMERIC_BALANCE_FIELDS) {
            if (!targetToSource.has(field))
                continue;
            const raw = getMappedValue(row, targetToSource, field);
            const s = cellString(raw);
            if (s && !isNumericValue(raw)) {
                issues.push(issue({
                    fileId: preview.fileId,
                    filename: preview.filename,
                    rowNumber,
                    severity: "error",
                    category: preview.category,
                    field,
                    message: "Balance value is not numeric",
                    value: s,
                }));
            }
        }
        for (const field of NUMERIC_AMOUNT_FIELDS) {
            if (!targetToSource.has(field))
                continue;
            const raw = getMappedValue(row, targetToSource, field);
            const s = cellString(raw);
            if (s && !isNumericValue(raw)) {
                issues.push(issue({
                    fileId: preview.fileId,
                    filename: preview.filename,
                    rowNumber,
                    severity: "error",
                    category: preview.category,
                    field,
                    message: "Amount value is not numeric",
                    value: s,
                }));
            }
        }
        if (targetToSource.has("transactionDate")) {
            const raw = getMappedValue(row, targetToSource, "transactionDate");
            const s = cellString(raw);
            if (s && !isValidDateValue(raw)) {
                issues.push(issue({
                    fileId: preview.fileId,
                    filename: preview.filename,
                    rowNumber,
                    severity: "error",
                    category: preview.category,
                    field: "transactionDate",
                    message: "Transaction date is invalid or unparseable",
                    value: s,
                }));
            }
        }
        if (targetToSource.has("idNumber")) {
            const raw = cellString(getMappedValue(row, targetToSource, "idNumber"));
            if (raw)
                idNumbers.push({ value: raw.toLowerCase(), rowNumber });
        }
        if (targetToSource.has("accountNumber")) {
            const raw = cellString(getMappedValue(row, targetToSource, "accountNumber"));
            if (raw)
                accountNumbers.push({ value: raw.toLowerCase(), rowNumber });
        }
    });
    const dupId = findDuplicates(idNumbers);
    for (const { value, rows: dupRows } of dupId) {
        issues.push(issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber: dupRows[0],
            severity: "error",
            category: preview.category,
            field: "idNumber",
            message: `Duplicate ID number in ${scopeLabel} (rows ${dupRows.join(", ")})`,
            value,
        }));
    }
    const dupAcc = findDuplicates(accountNumbers);
    for (const { value, rows: dupRows } of dupAcc) {
        issues.push(issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber: dupRows[0],
            severity: "warning",
            category: preview.category,
            field: "accountNumber",
            message: `Duplicate account number in ${scopeLabel} (rows ${dupRows.join(", ")})`,
            value,
        }));
    }
    return issues;
}
function findDuplicates(entries) {
    const byValue = new Map();
    for (const e of entries) {
        const list = byValue.get(e.value) ?? [];
        list.push(e.rowNumber);
        byValue.set(e.value, list);
    }
    const out = [];
    for (const [value, rows] of byValue) {
        if (rows.length > 1)
            out.push({ value, rows });
    }
    return out;
}
function emptyMappingsResult(mode) {
    return {
        summary: {
            mode,
            rowsChecked: 0,
            totalIssues: 0,
            errors: 0,
            warnings: 0,
            info: 0,
            canProceed: false,
            issuesShown: 0,
        },
        issues: [],
    };
}
function validateAllPreviews(previews, mappingsByFile, mode, rowsByFileId, cutoverDate) {
    const issues = [];
    let rowsChecked = 0;
    for (const preview of previews) {
        const rows = rowsByFileId.get(preview.fileId) ?? preview.sampleRows;
        rowsChecked += rows.length;
        issues.push(...validateFileRows({
            preview,
            fileMappings: mappingsByFile.get(preview.fileId),
            rows,
            fullFile: mode === "full",
        }));
    }
    issues.push(...(0, validateTransactionReadiness_1.validateTransactionReadiness)({
        previews,
        mappings: [...mappingsByFile.values()],
        rowsByFileId,
        cutoverDate,
    }));
    return applyIssueLimit(issues, mode, rowsChecked);
}
/**
 * Validate preview sample rows against selected column mappings (no DB, no staging).
 */
function validateMigrationPreview(input) {
    const mode = input.mode === "full" ? "full" : "preview";
    const previews = Array.isArray(input.previews) ? input.previews : [];
    const mappingsList = Array.isArray(input.mappings) ? input.mappings : [];
    const mappingsByFile = new Map(mappingsList.map((m) => [String(m.fileId || "").trim(), m]));
    if (mappingsList.length === 0) {
        return emptyMappingsResult(mode);
    }
    if (mode === "full") {
        throw new Error("Use validateMigrationFull for full-file validation");
    }
    const rowsByFileId = new Map();
    for (const preview of previews) {
        rowsByFileId.set(preview.fileId, preview.sampleRows);
    }
    return validateAllPreviews(previews, mappingsByFile, "preview", rowsByFileId, input.cutoverDate);
}
/**
 * Re-read staged files and validate every data row (no DB, no staging).
 */
async function validateMigrationFull(input) {
    const previews = Array.isArray(input.previews) ? input.previews : [];
    const mappingsList = Array.isArray(input.mappings) ? input.mappings : [];
    const filePaths = input.filePaths ?? {};
    const mappingsByFile = new Map(mappingsList.map((m) => [String(m.fileId || "").trim(), m]));
    if (mappingsList.length === 0) {
        return emptyMappingsResult("full");
    }
    const issues = [];
    const rowsByFileId = new Map();
    let rowsChecked = 0;
    for (const preview of previews) {
        const pathValue = String(preview.path || filePaths[preview.fileId] || "").trim();
        if (!pathValue) {
            issues.push(issue({
                fileId: preview.fileId,
                filename: preview.filename,
                rowNumber: 0,
                severity: "error",
                category: preview.category,
                field: "path",
                message: "Staged file path missing — re-upload before full-file validation",
                value: "",
            }));
            rowsByFileId.set(preview.fileId, preview.sampleRows);
            continue;
        }
        const file = {
            id: preview.fileId,
            filename: preview.filename,
            mimeType: "",
            size: 0,
            uploadedAt: new Date(),
            category: preview.category,
            path: pathValue,
        };
        const parsed = await (0, readMigrationFileRows_1.readMigrationFileRows)(file);
        rowsChecked += parsed.rowCount;
        rowsByFileId.set(preview.fileId, parsed.rows);
        for (const pi of parsed.parseIssues ?? []) {
            issues.push(issue({
                fileId: preview.fileId,
                filename: preview.filename,
                rowNumber: pi.rowNumber,
                severity: pi.severity,
                category: preview.category,
                field: pi.field,
                message: pi.message,
                value: "",
            }));
        }
        const parseIssueMessages = new Set((parsed.parseIssues ?? []).map((pi) => pi.message));
        for (const warn of parsed.warnings) {
            if (parseIssueMessages.has(warn))
                continue;
            issues.push(issue({
                fileId: preview.fileId,
                filename: preview.filename,
                rowNumber: 0,
                severity: "warning",
                category: preview.category,
                field: "file",
                message: warn,
                value: "",
            }));
        }
        const previewForValidation = {
            ...preview,
            columns: parsed.columns.length > 0 ? parsed.columns : preview.columns,
            rowCount: parsed.rowCount,
        };
        issues.push(...validateFileRows({
            preview: previewForValidation,
            fileMappings: mappingsByFile.get(preview.fileId),
            rows: parsed.rows,
            fullFile: true,
        }));
    }
    issues.push(...(0, validateTransactionReadiness_1.validateTransactionReadiness)({
        previews,
        mappings: mappingsList,
        rowsByFileId,
        cutoverDate: input.cutoverDate,
    }));
    return applyIssueLimit(issues, "full", rowsChecked);
}
/**
 * Validate migration data in preview or full mode.
 */
async function validateMigration(input) {
    const mode = input.mode === "full" ? "full" : "preview";
    if (mode === "full") {
        return validateMigrationFull(input);
    }
    return validateMigrationPreview({ ...input, mode: "preview" });
}
