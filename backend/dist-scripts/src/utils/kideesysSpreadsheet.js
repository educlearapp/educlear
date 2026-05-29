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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKideesysXmlSpreadsheet = isKideesysXmlSpreadsheet;
exports.parseKideesysSpreadsheetFile = parseKideesysSpreadsheetFile;
exports.parseKideesysSpreadsheetXml = parseKideesysSpreadsheetXml;
exports.parseKideesysSpreadsheetBuffer = parseKideesysSpreadsheetBuffer;
exports.normalizeMatchText = normalizeMatchText;
exports.splitFullName = splitFullName;
exports.learnerMatchKey = learnerMatchKey;
exports.parseClassTitle = parseClassTitle;
exports.parseKidEsysDate = parseKidEsysDate;
exports.parseAmount = parseAmount;
exports.isNumericIndexCell = isNumericIndexCell;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const XLSX = __importStar(require("xlsx"));
function decodeXmlEntities(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#10;/g, "\n")
        .replace(/&#13;/g, "\r");
}
function extractCellValue(cellXml) {
    const dataMatch = cellXml.match(/<Data[^>]*>([\s\S]*?)<\/Data>/i);
    if (!dataMatch)
        return "";
    return decodeXmlEntities(dataMatch[1].trim());
}
function parseRowCells(rowXml) {
    const cells = [];
    const cellRegex = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi;
    let match;
    while ((match = cellRegex.exec(rowXml)) !== null) {
        const attrs = match[1] || "";
        const body = match[2] || "";
        const indexMatch = attrs.match(/ss:Index="(\d+)"/i);
        const index = indexMatch ? Number(indexMatch[1]) : cells.length + 1;
        cells.push({ index, value: extractCellValue(body) });
    }
    if (!cells.length)
        return [];
    const maxIndex = Math.max(...cells.map((c) => c.index));
    const row = Array.from({ length: maxIndex }, () => "");
    for (const cell of cells) {
        row[cell.index - 1] = cell.value;
    }
    return row;
}
function parseWorksheet(xml, worksheetName) {
    const wsMatch = xml.match(/<Worksheet\b[^>]*ss:Name="([^"]*)"[^>]*>([\s\S]*?)<\/Worksheet>/i);
    const name = worksheetName || wsMatch?.[1] || "Report";
    const wsBody = wsMatch?.[2] || xml;
    const tableMatch = wsBody.match(/<ss:Table>([\s\S]*?)<\/ss:Table>/i);
    const tableBody = tableMatch?.[1] || wsBody;
    const rows = [];
    const rowRegex = /<Row\b[^>]*>([\s\S]*?)<\/Row>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableBody)) !== null) {
        rows.push(parseRowCells(rowMatch[1]));
    }
    return { name, rows };
}
/** True when .xls is SpreadsheetML XML (Kid-e-Sys), not binary BIFF (SA-SAMS). */
function isKideesysXmlSpreadsheet(buffer) {
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
    return head.includes("<?xml") && (head.includes("<Workbook") || head.includes(":Workbook"));
}
function sheetMatrixFromBinarySpreadsheet(buffer) {
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
/** Parse .xls/.xlsx: Kid-e-Sys XML SpreadsheetML or binary Excel (SA-SAMS). */
function parseKideesysSpreadsheetFile(filePath) {
    const buffer = fs_1.default.readFileSync(filePath);
    const stem = path_1.default.basename(filePath).replace(/\.(xls|xlsx)$/i, "");
    return parseKideesysSpreadsheetBuffer(buffer, stem);
}
function parseKideesysSpreadsheetXml(xml) {
    return parseWorksheet(xml);
}
function parseKideesysSpreadsheetBuffer(buffer, worksheetName) {
    if (isKideesysXmlSpreadsheet(buffer)) {
        const sheet = parseKideesysSpreadsheetXml(buffer.toString("utf8"));
        if (worksheetName)
            sheet.name = worksheetName;
        return sheet;
    }
    return {
        name: worksheetName || "Sheet1",
        rows: sheetMatrixFromBinarySpreadsheet(buffer),
    };
}
/** Normalise person / class labels for matching. */
function normalizeMatchText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9 ]/g, "");
}
function splitFullName(fullName) {
    const parts = String(fullName || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length)
        return { firstName: "", lastName: "" };
    if (parts.length === 1)
        return { firstName: parts[0], lastName: "" };
    return {
        firstName: parts.slice(0, -1).join(" "),
        lastName: parts[parts.length - 1],
    };
}
function learnerMatchKey(fullName, className) {
    // Lazy import avoided — canonical key set in parsers via classroomNormalization.
    const cls = normalizeMatchText(className);
    return `${normalizeMatchText(fullName)}|${cls}`;
}
function parseClassTitle(title) {
    const raw = String(title || "").trim().replace(/\s+/g, " ");
    const yearMatch = raw.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const className = raw.replace(/\s+20\d{2}\s*$/i, "").trim() || raw;
    return { className, year };
}
function parseKidEsysDate(value) {
    const v = String(value || "").trim();
    if (!v)
        return null;
    const slash = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (slash) {
        const [, y, m, d] = slash;
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso)
        return iso[0];
    return null;
}
function parseAmount(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    const n = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
}
function isNumericIndexCell(value) {
    return /^\d+(\.0)?$/.test(String(value || "").trim());
}
