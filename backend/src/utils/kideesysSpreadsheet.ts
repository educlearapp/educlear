import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

/** One worksheet table parsed from Kid-e-Sys SpreadsheetML (.xls XML). */
export type KideesysSheet = {
  name: string;
  rows: string[][];
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r");
}

function extractCellValue(cellXml: string): string {
  const dataMatch = cellXml.match(/<Data[^>]*>([\s\S]*?)<\/Data>/i);
  if (!dataMatch) return "";
  return decodeXmlEntities(dataMatch[1].trim());
}

function parseRowCells(rowXml: string): string[] {
  const cells: { index: number; value: string }[] = [];
  const cellRegex = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRegex.exec(rowXml)) !== null) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const indexMatch = attrs.match(/ss:Index="(\d+)"/i);
    const index = indexMatch ? Number(indexMatch[1]) : cells.length + 1;
    cells.push({ index, value: extractCellValue(body) });
  }
  if (!cells.length) return [];
  const maxIndex = Math.max(...cells.map((c) => c.index));
  const row = Array.from({ length: maxIndex }, () => "");
  for (const cell of cells) {
    row[cell.index - 1] = cell.value;
  }
  return row;
}

function parseWorksheet(xml: string, worksheetName?: string): KideesysSheet {
  const wsMatch = xml.match(/<Worksheet\b[^>]*ss:Name="([^"]*)"[^>]*>([\s\S]*?)<\/Worksheet>/i);
  const name = worksheetName || wsMatch?.[1] || "Report";
  const wsBody = wsMatch?.[2] || xml;
  const tableMatch = wsBody.match(/<ss:Table>([\s\S]*?)<\/ss:Table>/i);
  const tableBody = tableMatch?.[1] || wsBody;
  const rows: string[][] = [];
  const rowRegex = /<Row\b[^>]*>([\s\S]*?)<\/Row>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(tableBody)) !== null) {
    rows.push(parseRowCells(rowMatch[1]));
  }
  return { name, rows };
}

/** True when .xls is SpreadsheetML XML (Kid-e-Sys), not binary BIFF (SA-SAMS). */
export function isKideesysXmlSpreadsheet(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
  return head.includes("<?xml") && (head.includes("<Workbook") || head.includes(":Workbook"));
}

function sheetMatrixFromBinarySpreadsheet(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  return raw.map((row) => row.map((cell) => String(cell ?? "").trim()));
}

/** Parse .xls/.xlsx: Kid-e-Sys XML SpreadsheetML or binary Excel (SA-SAMS). */
export function parseKideesysSpreadsheetFile(filePath: string): KideesysSheet {
  const buffer = fs.readFileSync(filePath);
  const stem = path.basename(filePath).replace(/\.(xls|xlsx)$/i, "");
  return parseKideesysSpreadsheetBuffer(buffer, stem);
}

export function parseKideesysSpreadsheetXml(xml: string): KideesysSheet {
  return parseWorksheet(xml);
}

export function parseKideesysSpreadsheetBuffer(buffer: Buffer, worksheetName?: string): KideesysSheet {
  if (isKideesysXmlSpreadsheet(buffer)) {
    const sheet = parseKideesysSpreadsheetXml(buffer.toString("utf8"));
    if (worksheetName) sheet.name = worksheetName;
    return sheet;
  }
  return {
    name: worksheetName || "Sheet1",
    rows: sheetMatrixFromBinarySpreadsheet(buffer),
  };
}

/** Normalise person / class labels for matching. */
export function normalizeMatchText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export function learnerMatchKey(fullName: string, className: string): string {
  // Lazy import avoided — canonical key set in parsers via classroomNormalization.
  const cls = normalizeMatchText(className);
  return `${normalizeMatchText(fullName)}|${cls}`;
}

export function parseClassTitle(title: string): { className: string; year: number | null } {
  const raw = String(title || "").trim().replace(/\s+/g, " ");
  const yearMatch = raw.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const className = raw.replace(/\s+20\d{2}\s*$/i, "").trim() || raw;
  return { className, year };
}

export function parseKidEsysDate(value: string): string | null {
  const v = String(value || "").trim();
  if (!v) return null;
  const slash = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slash) {
    const [, y, m, d] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return null;
}

export function parseAmount(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function isNumericIndexCell(value: string): boolean {
  return /^\d+(\.0)?$/.test(String(value || "").trim());
}
