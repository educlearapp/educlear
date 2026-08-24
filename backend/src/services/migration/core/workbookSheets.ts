/**
 * Read every worksheet from a CSV/XLS/XLSX buffer.
 * A workbook is a container of datasets — never concatenated.
 */

import * as XLSX from "xlsx";
import {
  isKideesysXmlSpreadsheet,
  parseAllKideesysSpreadsheetSheets,
} from "../../../utils/kideesysSpreadsheet";

export type WorkbookSheetMatrix = {
  name: string;
  matrix: string[][];
};

function sheetToMatrix(sheet: XLSX.WorkSheet | undefined): string[][] {
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  return raw.map((row) => row.map((cell) => String(cell ?? "").trim()));
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
  return out.map((c) => c.trim());
}

function csvToMatrix(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => splitCsvLine(line))
    .filter((row) => row.some((c) => String(c || "").trim()));
}

export function listWorkbookSheets(buffer: Buffer, fileName: string): WorkbookSheetMatrix[] {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".pdf")) {
    if (lower.endsWith(".pdf")) return [];
    return [{ name: "Sheet1", matrix: csvToMatrix(buffer.toString("utf8")) }];
  }

  if (lower.endsWith(".xls") && isKideesysXmlSpreadsheet(buffer)) {
    return parseAllKideesysSpreadsheetSheets(buffer).map((sheet) => ({
      name: sheet.name,
      matrix: sheet.rows,
    }));
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return (workbook.SheetNames || []).map((name) => ({
    name,
    matrix: sheetToMatrix(workbook.Sheets[name]),
  }));
}

export function matrixForSheet(
  buffer: Buffer,
  fileName: string,
  worksheetName?: string
): { name: string; matrix: string[][] } {
  const sheets = listWorkbookSheets(buffer, fileName);
  if (!sheets.length) return { name: worksheetName || "Sheet1", matrix: [] };
  if (!worksheetName) return sheets[0]!;
  const wanted = worksheetName.trim().toLowerCase();
  const match = sheets.find((s) => s.name.trim().toLowerCase() === wanted);
  return match || { name: worksheetName, matrix: [] };
}
