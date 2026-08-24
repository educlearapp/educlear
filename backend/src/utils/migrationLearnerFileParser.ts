import { normalizeKidESysLearnerClassListSheet } from "../services/migration/adapters/kideesysLearnerClassListNormalization";
import { isKideesysXmlSpreadsheet, parseKideesysSpreadsheetBuffer } from "./kideesysSpreadsheet";
import {
  detectTabularHeaderRow,
  matrixToRecordsFromHeader,
} from "../services/migration/core/detectTabularHeaderRow";
import { matrixForSheet } from "../services/migration/core/workbookSheets";

export type MigrationParseIssue = {
  severity: "info" | "warning";
  field: string;
  message: string;
  rowNumber: number;
};

export type ParsedMigrationLearnerTable = {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
  parseIssues?: MigrationParseIssue[];
};

export function isAcceptedLearnerMigrationFileName(fileName: string): boolean {
  const lower = String(fileName || "").toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".xls") || lower.endsWith(".xlsx");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
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

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => !c.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }

  return { headers, rows };
}

function matrixToRecords(matrix: string[][]): { headers: string[]; rows: Record<string, string>[] } {
  if (!matrix.length) return { headers: [], rows: [] };
  const detected = detectTabularHeaderRow(matrix);
  if (!detected) return { headers: [], rows: [] };
  const parsed = matrixToRecordsFromHeader(matrix, detected.headerRowIndex);
  return { headers: parsed.headers, rows: parsed.rows };
}

export function readMigrationSpreadsheetMatrix(
  buffer: Buffer,
  fileName: string,
  worksheetName?: string
): string[][] {
  return matrixForSheet(buffer, fileName, worksheetName).matrix;
}

export function parseMigrationLearnerFileBuffer(
  buffer: Buffer,
  fileName: string,
  worksheetName?: string
): ParsedMigrationLearnerTable {
  const lower = String(fileName || "").toLowerCase();
  if (!isAcceptedLearnerMigrationFileName(fileName)) {
    throw new Error("Learner file must be CSV, XLS, or XLSX.");
  }

  const matrix = readMigrationSpreadsheetMatrix(buffer, fileName, worksheetName);
  const normalized = normalizeKidESysLearnerClassListSheet(matrix, fileName);
  if (normalized) return normalized;

  if (lower.endsWith(".xls") && isKideesysXmlSpreadsheet(buffer)) {
    const sheet = parseKideesysSpreadsheetBuffer(buffer, worksheetName);
    const xmlNormalized = normalizeKidESysLearnerClassListSheet(sheet.rows, fileName);
    if (xmlNormalized) return xmlNormalized;
    const parsedXml = matrixToRecords(sheet.rows);
    return { ...parsedXml, fileName };
  }

  const parsed = matrixToRecords(matrix);
  return { ...parsed, fileName };
}
