import type { ParsedMigrationLearnerTable } from "../../../utils/migrationLearnerFileParser";
import {
  isNumericIndexCell,
  parseClassTitle,
} from "../../../utils/kideesysSpreadsheet";

function rowText(row: string[], index: number): string {
  return String(row[index] ?? "").trim();
}

function compactCell(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const CHILD_LIST_EXTRA_HEADER_ALIASES: Record<string, string> = {
  age: "Age",
  birthdate: "Birth Date",
  gender: "Gender",
  parent1contactinfo: "Parent 1 Contact Info",
  parent2contactinfo: "Parent 2 Contact Info",
  enrolmentdate: "Enrolment Date",
  enrollmentdate: "Enrollment Date",
};

const CHILD_LIST_REQUIRED_HEADER_KEYS = [
  "age",
  "birthdate",
  "gender",
  "parent1contactinfo",
  "parent2contactinfo",
] as const;

/**
 * Kid-e-Sys per-class learner exports use a title row (e.g. "Grade 1A 2026") with no header row;
 * column A is a numeric index and column B holds learner full names.
 */
export function isKidESysClassListTitleCell(value: string): boolean {
  const v = String(value || "").trim().replace(/\s+/g, " ");
  if (!v) return false;
  if (/total$/i.test(v)) return false;
  if (/^\d+(\.\d+)?$/.test(v)) return false;

  const withoutYear = v.replace(/\s+20\d{2}\s*$/i, "").trim();

  if (/^no\s+classroom$/i.test(withoutYear)) return true;
  if (/^creche(\s+20\d{2})?$/i.test(v)) return true;
  if (/^reception(\s+20\d{2})?$/i.test(v)) return true;
  if (/^rrr?(\s+20\d{2})?$/i.test(withoutYear)) return true;
  if (/^pre[-\s]?school(\s+20\d{2})?$/i.test(withoutYear)) return true;
  if (/^preschool(\s+20\d{2})?$/i.test(withoutYear)) return true;
  if (/\bclass$/i.test(withoutYear)) return true;
  if (/\bgrade\s*r\b/i.test(withoutYear)) return true;
  if (/^active\b/i.test(withoutYear)) return true;

  // Exclude fee descriptions like "GRADE 8" (no class stream letter).
  if (/^grade\s+\d{1,2}$/i.test(withoutYear)) return false;
  return /^grade\b/i.test(withoutYear);
}

function findClassListTitleRow(matrix: string[][]): { rowIndex: number; classTitle: string } | null {
  const scanLimit = Math.min(matrix.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const row = matrix[i];
    const c0 = rowText(row, 0);
    const c1 = rowText(row, 1);
    if (isKidESysClassListTitleCell(c0)) {
      return { rowIndex: i, classTitle: c0 };
    }
    if (isKidESysClassListTitleCell(c1)) {
      return { rowIndex: i, classTitle: c1 };
    }
    const nonEmpty = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (nonEmpty.length === 1 && isKidESysClassListTitleCell(nonEmpty[0])) {
      return { rowIndex: i, classTitle: nonEmpty[0] };
    }
  }
  return null;
}

function classListTitleFromRow(row: string[]): string {
  const c0 = rowText(row, 0);
  const c1 = rowText(row, 1);
  if (isKidESysClassListTitleCell(c0)) return c0;
  if (isKidESysClassListTitleCell(c1)) return c1;
  const nonEmpty = row.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (nonEmpty.length === 1 && isKidESysClassListTitleCell(nonEmpty[0])) {
    return nonEmpty[0];
  }
  return "";
}

function isKidESysChildListTitleCell(value: string): boolean {
  const v = String(value || "").trim().replace(/\s+/g, " ");
  if (!v) return false;
  if (isKidESysClassListTitleCell(v)) return true;

  const withoutYear = v.replace(/\s+20\d{2}\s*$/i, "").trim();
  if (/^no\s+classroom$/i.test(withoutYear)) return true;
  return /\bclass$/i.test(withoutYear);
}

function childListTitleFromRow(row: string[]): string {
  const nonEmpty = row.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (nonEmpty.length !== 1) return "";
  return isKidESysChildListTitleCell(nonEmpty[0]) ? nonEmpty[0] : "";
}

function looksLikeLearnerName(value: string): boolean {
  const v = String(value || "").trim();
  if (v.length < 2) return false;
  if (/^(cell|work|home)\s*no$/i.test(v)) return false;
  if (/^(father|mother|guardian)\b/i.test(v)) return false;
  if (/^\d+(\.\d+)?$/.test(v)) return false;
  return /[a-z]/i.test(v);
}

function learnerNameFromIndexedRow(row: string[]): string {
  const direct = rowText(row, 1);
  if (looksLikeLearnerName(direct)) return direct;

  if (!isNumericIndexCell(rowText(row, 0))) return "";
  for (let i = 2; i < row.length; i++) {
    const value = rowText(row, i);
    if (looksLikeLearnerName(value)) return value;
  }
  return "";
}

function countIndexedLearnerRows(matrix: string[][], afterRow: number): number {
  let count = 0;
  for (let i = afterRow + 1; i < matrix.length; i++) {
    const row = matrix[i];
    const c0 = rowText(row, 0);
    const fullName = learnerNameFromIndexedRow(row);
    if (!fullName) continue;
    if (!isNumericIndexCell(c0)) continue;
    count++;
  }
  return count;
}

export function isKidESysLearnerClassListLayout(matrix: string[][]): boolean {
  if (!matrix.length) return false;
  const childList = normalizeKidESysChildListExtraFieldsSheet(matrix, "__layout__.xls");
  if (childList) return true;
  const title = findClassListTitleRow(matrix);
  if (!title) return false;
  return countIndexedLearnerRows(matrix, title.rowIndex) > 0;
}

type ChildListExtraHeader = {
  header: string;
  columnIndex: number;
};

function childListExtraHeadersFromRow(row: string[]): ChildListExtraHeader[] {
  const headers: ChildListExtraHeader[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < row.length; i++) {
    const header = String(row[i] ?? "").trim().replace(/\s+/g, " ");
    const key = compactCell(header);
    const canonical = CHILD_LIST_EXTRA_HEADER_ALIASES[key];
    if (!canonical || seen.has(key)) continue;
    const columnIndex =
      key === "age" && i === 0 && !rowText(row, 1) && !rowText(row, 2) ? 2 : i;
    headers.push({ header: canonical, columnIndex });
    seen.add(key);
  }
  return headers;
}

function isCompleteChildListExtraHeaderSet(headers: ChildListExtraHeader[]): boolean {
  const keys = new Set(headers.map((h) => compactCell(h.header)));
  return CHILD_LIST_REQUIRED_HEADER_KEYS.every((key) => keys.has(key));
}

function findChildListHeaderRow(
  matrix: string[][],
  titleRowIndex: number
): { title: string; headerRowIndex: number; extraHeaders: ChildListExtraHeader[] } | null {
  const titleRow = matrix[titleRowIndex] || [];
  const title =
    childListTitleFromRow(titleRow) ||
    (isKidESysChildListTitleCell(rowText(titleRow, 0)) ? rowText(titleRow, 0) : "");
  if (!title) return null;

  for (const headerRowIndex of [titleRowIndex, titleRowIndex + 1]) {
    const extraHeaders = childListExtraHeadersFromRow(matrix[headerRowIndex] || []);
    if (isCompleteChildListExtraHeaderSet(extraHeaders)) {
      return { title, headerRowIndex, extraHeaders };
    }
  }

  return null;
}

function normalizeKidESysChildListExtraFieldsSheet(
  matrix: string[][],
  fileName: string
): ParsedMigrationLearnerTable | null {
  const rows: Record<string, string>[] = [];
  let headers: string[] | null = null;

  for (let i = 0; i < matrix.length; i++) {
    const headerInfo = findChildListHeaderRow(matrix, i);
    if (!headerInfo) continue;

    const { title, headerRowIndex, extraHeaders } = headerInfo;
    const { className } = parseClassTitle(title);
    const classroom = className || title;
    if (!headers) {
      headers = ["fullName", ...extraHeaders.map((h) => h.header), "classroom"];
    }

    for (let j = headerRowIndex + 1; j < matrix.length; j++) {
      const dataRow = matrix[j] || [];
      if (childListTitleFromRow(dataRow)) break;

      const fullName = learnerNameFromIndexedRow(dataRow);
      if (!fullName) continue;

      const out: Record<string, string> = {
        fullName,
        classroom,
      };
      for (const header of extraHeaders) {
        out[header.header] = rowText(dataRow, header.columnIndex);
      }
      rows.push(out);
    }
  }

  if (!headers || rows.length === 0) return null;

  return {
    headers,
    rows,
    fileName,
  };
}

/**
 * Normalize Kid-e-Sys class-list sheets to standard preview columns (fullName, status, classroom).
 * Returns null when the sheet does not match the class-list layout.
 */
export function normalizeKidESysLearnerClassListSheet(
  matrix: string[][],
  fileName: string
): ParsedMigrationLearnerTable | null {
  if (!matrix.length) return null;

  const childList = normalizeKidESysChildListExtraFieldsSheet(matrix, fileName);
  if (childList) return childList;

  const titleInfo = findClassListTitleRow(matrix);
  if (!titleInfo) return null;

  const learnerRowCount = countIndexedLearnerRows(matrix, titleInfo.rowIndex);
  if (learnerRowCount === 0) return null;

  const { className } = parseClassTitle(titleInfo.classTitle);
  const classroom = className || titleInfo.classTitle;

  const rows: Record<string, string>[] = [];
  for (let i = titleInfo.rowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    const c0 = rowText(row, 0);
    const fullName = learnerNameFromIndexedRow(row);
    if (!fullName) continue;
    if (!isNumericIndexCell(c0)) continue;
    rows.push({
      fullName,
      status: "ACTIVE",
      classroom,
    });
  }

  if (rows.length === 0) return null;

  return {
    headers: ["fullName", "status", "classroom"],
    rows,
    fileName,
    parseIssues: [
      {
        severity: "info",
        field: "status",
        message: "Kid-e-Sys Class List has no learner status column; learners default to ACTIVE.",
        rowNumber: 0,
      },
    ],
  };
}
