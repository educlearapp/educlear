import * as XLSX from "xlsx";
import { normalizeKidESysLearnerClassListSheet } from "../services/migration/adapters/kideesysLearnerClassListNormalization";
import { parseKideesysSpreadsheetBuffer } from "./kideesysSpreadsheet";

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

  let headerIdx = 0;
  while (
    headerIdx < matrix.length &&
    matrix[headerIdx].every((c) => !String(c ?? "").trim())
  ) {
    headerIdx++;
  }
  if (headerIdx >= matrix.length) return { headers: [], rows: [] };

  const headers = matrix[headerIdx].map((h) => String(h ?? "").trim());
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (cells.every((c) => !String(c ?? "").trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = String(cells[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

export function readMigrationSpreadsheetMatrix(buffer: Buffer, fileName: string): string[][] {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".csv")) {
    const parsed = parseCsvText(buffer.toString("utf8"));
    const matrix: string[][] = [];
    if (parsed.headers.length) matrix.push(parsed.headers);
    for (const row of parsed.rows) {
      matrix.push(parsed.headers.map((h) => String(row[h] ?? "")));
    }
    return matrix;
  }

  if (lower.endsWith(".xls") && isKideesysXmlSpreadsheet(buffer)) {
    const sheet = parseKideesysSpreadsheetBuffer(buffer);
    return sheet.rows;
  }

  return sheetMatrixFromXlsx(buffer);
}

function sheetMatrixFromXlsx(buffer: Buffer): string[][] {
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

function isKideesysXmlSpreadsheet(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
  return head.includes("<?xml") && (head.includes("<Workbook") || head.includes(":Workbook"));
}

export function parseMigrationLearnerFileBuffer(
  buffer: Buffer,
  fileName: string
): ParsedMigrationLearnerTable {
  const lower = String(fileName || "").toLowerCase();
  if (!isAcceptedLearnerMigrationFileName(fileName)) {
    throw new Error("Learner file must be CSV, XLS, or XLSX.");
  }

  if (lower.endsWith(".csv")) {
    const parsed = parseCsvText(buffer.toString("utf8"));
    return { ...parsed, fileName };
  }

  if (lower.endsWith(".xls") && isKideesysXmlSpreadsheet(buffer)) {
    const sheet = parseKideesysSpreadsheetBuffer(buffer);
    const normalized = normalizeKidESysLearnerClassListSheet(sheet.rows, fileName);
    if (normalized) return normalized;
    const parsed = matrixToRecords(sheet.rows);
    return { ...parsed, fileName };
  }

  const matrix = sheetMatrixFromXlsx(buffer);
  const normalized = normalizeKidESysLearnerClassListSheet(matrix, fileName);
  if (normalized) return normalized;
  const parsed = matrixToRecords(matrix);
  return { ...parsed, fileName };
}
