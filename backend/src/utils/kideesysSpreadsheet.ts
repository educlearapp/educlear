import fs from "fs";

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

/** Parse Kid-e-Sys XML spreadsheet export (.xls) into row matrices. */
export function parseKideesysSpreadsheetFile(filePath: string): KideesysSheet {
  const xml = fs.readFileSync(filePath, "utf8");
  return parseKideesysSpreadsheetXml(xml);
}

export function parseKideesysSpreadsheetXml(xml: string): KideesysSheet {
  return parseWorksheet(xml);
}

export function parseKideesysSpreadsheetBuffer(buffer: Buffer): KideesysSheet {
  return parseKideesysSpreadsheetXml(buffer.toString("utf8"));
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
