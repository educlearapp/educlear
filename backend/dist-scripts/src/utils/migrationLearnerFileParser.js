"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAcceptedLearnerMigrationFileName = isAcceptedLearnerMigrationFileName;
exports.parseCsvText = parseCsvText;
exports.readMigrationSpreadsheetMatrix = readMigrationSpreadsheetMatrix;
exports.parseMigrationLearnerFileBuffer = parseMigrationLearnerFileBuffer;
const XLSX = __importStar(require("xlsx"));
const kideesysLearnerClassListNormalization_1 = require("../services/migration/adapters/kideesysLearnerClassListNormalization");
const kideesysSpreadsheet_1 = require("./kideesysSpreadsheet");
function isAcceptedLearnerMigrationFileName(fileName) {
    const lower = String(fileName || "").toLowerCase();
    return lower.endsWith(".csv") || lower.endsWith(".xls") || lower.endsWith(".xlsx");
}
function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            }
            else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === "," && !inQuotes) {
            out.push(cur);
            cur = "";
            continue;
        }
        cur += ch;
    }
    out.push(cur);
    return out;
}
function parseCsvText(text) {
    const lines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    if (lines.length === 0)
        return { headers: [], rows: [] };
    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i]);
        if (cells.every((c) => !c.trim()))
            continue;
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = cells[idx] ?? "";
        });
        rows.push(row);
    }
    return { headers, rows };
}
function matrixToRecords(matrix) {
    if (!matrix.length)
        return { headers: [], rows: [] };
    let headerIdx = 0;
    while (headerIdx < matrix.length &&
        matrix[headerIdx].every((c) => !String(c ?? "").trim())) {
        headerIdx++;
    }
    if (headerIdx >= matrix.length)
        return { headers: [], rows: [] };
    const headers = matrix[headerIdx].map((h) => String(h ?? "").trim());
    const rows = [];
    for (let i = headerIdx + 1; i < matrix.length; i++) {
        const cells = matrix[i];
        if (cells.every((c) => !String(c ?? "").trim()))
            continue;
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = String(cells[idx] ?? "").trim();
        });
        rows.push(row);
    }
    return { headers, rows };
}
function readMigrationSpreadsheetMatrix(buffer, fileName) {
    const lower = String(fileName || "").toLowerCase();
    if (lower.endsWith(".csv")) {
        const parsed = parseCsvText(buffer.toString("utf8"));
        const matrix = [];
        if (parsed.headers.length)
            matrix.push(parsed.headers);
        for (const row of parsed.rows) {
            matrix.push(parsed.headers.map((h) => String(row[h] ?? "")));
        }
        return matrix;
    }
    if (lower.endsWith(".xls") && isKideesysXmlSpreadsheet(buffer)) {
        const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetBuffer)(buffer);
        return sheet.rows;
    }
    return sheetMatrixFromXlsx(buffer);
}
function sheetMatrixFromXlsx(buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
        return [];
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
    });
    return raw.map((row) => row.map((cell) => String(cell ?? "").trim()));
}
function isKideesysXmlSpreadsheet(buffer) {
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
    return head.includes("<?xml") && (head.includes("<Workbook") || head.includes(":Workbook"));
}
function parseMigrationLearnerFileBuffer(buffer, fileName) {
    const lower = String(fileName || "").toLowerCase();
    if (!isAcceptedLearnerMigrationFileName(fileName)) {
        throw new Error("Learner file must be CSV, XLS, or XLSX.");
    }
    if (lower.endsWith(".csv")) {
        const parsed = parseCsvText(buffer.toString("utf8"));
        return { ...parsed, fileName };
    }
    if (lower.endsWith(".xls") && isKideesysXmlSpreadsheet(buffer)) {
        const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetBuffer)(buffer);
        const normalized = (0, kideesysLearnerClassListNormalization_1.normalizeKidESysLearnerClassListSheet)(sheet.rows, fileName);
        if (normalized)
            return normalized;
        const parsed = matrixToRecords(sheet.rows);
        return { ...parsed, fileName };
    }
    const matrix = sheetMatrixFromXlsx(buffer);
    const normalized = (0, kideesysLearnerClassListNormalization_1.normalizeKidESysLearnerClassListSheet)(matrix, fileName);
    if (normalized)
        return normalized;
    const parsed = matrixToRecords(matrix);
    return { ...parsed, fileName };
}
