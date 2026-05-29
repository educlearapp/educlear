"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.csvCell = csvCell;
exports.buildCsvContent = buildCsvContent;
/** Escape a cell for CSV (RFC-style quoting). */
function csvCell(value) {
    const text = value == null ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}
function buildCsvContent(headers, rows) {
    const headerLine = headers.map(csvCell).join(",");
    const body = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    return `${headerLine}\n${body}\n`;
}
