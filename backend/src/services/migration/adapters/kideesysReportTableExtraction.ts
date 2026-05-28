import type { ParsedMigrationLearnerTable } from "../../../utils/migrationLearnerFileParser";
import { isNumericIndexCell } from "../../../utils/kideesysSpreadsheet";
import { evaluateKidESysDetection } from "./kideesysDetection";
import { normalizeKidESysContactListSheet } from "./kideesysContactListNormalization";
import { normalizeKidESysLearnerClassListSheet } from "./kideesysLearnerClassListNormalization";
import {
  isLearnerClassExportFilename,
} from "../core/detectMigrationCategory";
import { isKidESysClassListTitleCell } from "./kideesysLearnerClassListNormalization";

const SCAN_ROW_LIMIT = 30;
const MIN_HEADER_SIGNALS = 2;

const BILLING_HEADER_SIGNALS = [
  "account",
  "accountname",
  "child",
  "balance",
  "current",
  "30",
  "60",
  "90",
  "120",
  "outstanding",
  "baddebt",
];

const TRANSACTION_HEADER_SIGNALS = [
  "date",
  "transactiondate",
  "account",
  "child",
  "type",
  "reference",
  "receipt",
  "invoice",
  "amount",
  "debit",
  "credit",
  "balance",
  "description",
];

const CONTACT_HEADER_SIGNALS = [
  "parent",
  "guardian",
  "contact",
  "cell",
  "mobile",
  "phone",
  "email",
  "child",
];

const ALL_HEADER_SIGNALS = [
  ...BILLING_HEADER_SIGNALS,
  ...TRANSACTION_HEADER_SIGNALS,
  ...CONTACT_HEADER_SIGNALS,
];

const INFERRED_TRANSACTION_HEADERS = [
  "#",
  "Reference",
  "Date",
  "Account",
  "Child",
  "Notes",
  "Amount",
];

const ACCOUNT_CODE_RE = /^[A-Z]{2,5}\d{2,5}$/;

function compactCell(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function filenameHaystack(filename: string): string {
  const leaf = String(filename || "")
    .trim()
    .split(/[/\\]/)
    .pop();
  const base = String(leaf || "").replace(/\.[^.]+$/i, "");
  return `${base}${filename}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function shouldUseKideesysReportExtraction(
  filename: string,
  sourceSystem?: string
): boolean {
  const system = String(sourceSystem || "")
    .trim()
    .toLowerCase();
  if (system === "kideesys") return true;

  const haystack = filenameHaystack(filename);
  if (evaluateKidESysDetection({ filenames: [filename] }).detected) return true;

  if (isLearnerClassExportFilename(haystack, filename.split(/[/\\]/).pop()?.replace(/\.[^.]+$/i, "") || "")) {
    return true;
  }

  return (
    haystack.includes("accountlist") ||
    haystack.includes("transactionlist") ||
    haystack.includes("contactlist") ||
    haystack.includes("ageanalysis") ||
    haystack.includes("billingplan")
  );
}

function cellMatchesSignal(cell: string, signal: string): boolean {
  const compact = compactCell(cell);
  const sig = compactCell(signal);
  if (!compact || !sig) return false;
  if (compact === sig) return true;
  if (sig.length <= 3 && /^\d+$/.test(sig)) {
    return compact === `${sig}days` || compact.startsWith(sig);
  }
  return compact.includes(sig);
}

function countHeaderSignals(row: string[]): number {
  let matched = 0;
  for (const cell of row) {
    const trimmed = String(cell ?? "").trim();
    if (!trimmed) continue;
    if (ALL_HEADER_SIGNALS.some((signal) => cellMatchesSignal(trimmed, signal))) {
      matched += 1;
    }
  }
  return matched;
}

function rowLooksLikeDataNotHeader(row: string[]): boolean {
  const c0 = String(row[0] ?? "").trim();
  const c1 = String(row[1] ?? "").trim();
  if (isNumericIndexCell(c0) && /^(invoice|payment)\s+\d+/i.test(c1)) return true;
  if (ACCOUNT_CODE_RE.test(c1) && String(row[2] ?? "").trim().length > 1) return true;
  return false;
}

function isReportTitleOnlyRow(row: string[]): boolean {
  const nonEmpty = row.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (nonEmpty.length !== 1) return false;
  return isKidESysClassListTitleCell(nonEmpty[0]);
}

function isProbableHeaderRow(row: string[]): boolean {
  if (rowLooksLikeDataNotHeader(row)) return false;
  if (isReportTitleOnlyRow(row)) return false;
  const nonEmpty = row.filter((c) => String(c ?? "").trim().length > 0);
  if (nonEmpty.length < 2) return false;
  return countHeaderSignals(row) >= MIN_HEADER_SIGNALS;
}

function findBestHeaderRowIndex(matrix: string[][]): number | null {
  const limit = Math.min(matrix.length, SCAN_ROW_LIMIT);
  let bestIdx: number | null = null;
  let bestScore = 0;

  for (let i = 0; i < limit; i++) {
    const row = matrix[i] || [];
    if (!isProbableHeaderRow(row)) continue;
    const score = countHeaderSignals(row);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx === null || bestScore < MIN_HEADER_SIGNALS) return null;
  return bestIdx;
}

function makeUniqueColumnHeaders(cells: string[]): string[] {
  const used = new Set<string>();
  return cells.map((cell, idx) => {
    let header = String(cell ?? "").trim();
    if (!header) {
      header = `Column ${idx + 1}`;
    }
    const base = header;
    let suffix = 2;
    while (used.has(header.toLowerCase())) {
      header = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(header.toLowerCase());
    return header;
  });
}

function enrichEmptyHeaders(headers: string[]): string[] {
  return headers.map((header, idx) => {
    if (header.trim()) return header;
    const prev = compactCell(headers[idx - 1] || "");
    if (prev === "account" || prev === "accountname") return "Account Name";
    if (prev === "child") return "Child Name";
    return header;
  });
}

function rowHasAnyValue(row: string[]): boolean {
  return row.some((c) => String(c ?? "").trim().length > 0);
}

function shouldDropLeadingIndexColumn(dataRows: string[][]): boolean {
  if (dataRows.length < 2) return false;
  const sample = dataRows.slice(0, Math.min(40, dataRows.length));
  let numeric = 0;
  let nonEmpty = 0;
  for (const row of sample) {
    const value = String(row[0] ?? "").trim();
    if (!value) continue;
    nonEmpty += 1;
    if (isNumericIndexCell(value)) numeric += 1;
  }
  return nonEmpty >= 2 && numeric / nonEmpty >= 0.85;
}

function matrixRowsToRecords(
  headers: string[],
  matrix: string[][],
  startRow: number
): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (let i = startRow; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    if (!rowHasAnyValue(cells)) continue;
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = String(cells[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

function isTransactionExportFilename(filename: string): boolean {
  const haystack = filenameHaystack(filename);
  return haystack.includes("transactionlist") || haystack.includes("transaction");
}

function looksLikeTransactionDataRow(row: string[]): boolean {
  const c0 = String(row[0] ?? "").trim();
  const c1 = String(row[1] ?? "").trim();
  const c2 = String(row[2] ?? "").trim();
  const c3 = String(row[3] ?? "").trim();
  if (!isNumericIndexCell(c0) || !c1 || !c3) return false;
  return /^(invoice|payment)\s+\d+/i.test(c1);
}

function findTransactionDataStart(matrix: string[][]): number | null {
  const limit = Math.min(matrix.length, SCAN_ROW_LIMIT);
  for (let i = 0; i < limit; i++) {
    if (looksLikeTransactionDataRow(matrix[i] || [])) return i;
  }
  for (let i = 0; i < matrix.length; i++) {
    if (looksLikeTransactionDataRow(matrix[i] || [])) return i;
  }
  return null;
}

function maxRowWidth(matrix: string[][], fromRow: number): number {
  let width = 0;
  for (let i = fromRow; i < matrix.length; i++) {
    width = Math.max(width, (matrix[i] || []).length);
  }
  return width;
}

function looksLikeAmountCell(value: string): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  return /^-?[\d,]+(\.\d+)?$/.test(v.replace(/,/g, ""));
}

function alignKidESysBillingHeaders(headerCells: string[], sampleRow: string[]): string[] {
  const out: string[] = [];
  let di = 0;

  for (let hi = 1; hi < headerCells.length; hi++) {
    const header = String(headerCells[hi] ?? "").trim();
    let cell = String(sampleRow[di] ?? "").trim();

    if (!header) {
      if (ACCOUNT_CODE_RE.test(cell)) {
        out.push("Account");
      } else if (cell && /[a-z]/i.test(cell)) {
        out.push("Account Name");
      } else if (cell) {
        out.push(`Column ${out.length + 1}`);
      }
      if (cell) di += 1;
      continue;
    }

    if (compactCell(header) === "balance" && cell && !looksLikeAmountCell(cell)) {
      out.push("Account Name");
      di += 1;
      cell = String(sampleRow[di] ?? "").trim();
    }

    out.push(header);
    if (cell) di += 1;
  }

  while (di < sampleRow.length) {
    const cell = String(sampleRow[di] ?? "").trim();
    if (cell) out.push(`Column ${out.length + 1}`);
    di += 1;
  }

  return makeUniqueColumnHeaders(enrichEmptyHeaders(out));
}

function extractFromHeaderRow(
  matrix: string[][],
  headerRowIndex: number,
  fileName: string
): ParsedMigrationLearnerTable | null {
  const headerCells = (matrix[headerRowIndex] || []).map((c) => String(c ?? "").trim());
  if (!headerCells.some(Boolean)) return null;

  let headers = headerCells;
  const dataMatrix = matrix.slice(headerRowIndex + 1).filter(rowHasAnyValue);

  if (shouldDropLeadingIndexColumn(dataMatrix)) {
    const trimmed = dataMatrix.map((row) => row.slice(1));
    headers = alignKidESysBillingHeaders(headerCells, trimmed[0] || []);
    const rows = matrixRowsToRecords(headers, trimmed, 0);
    if (rows.length === 0) return null;
    return { headers, rows, fileName };
  }

  headers = makeUniqueColumnHeaders(enrichEmptyHeaders(headers));
  const rows = matrixRowsToRecords(headers, dataMatrix, 0);
  if (rows.length === 0) return null;
  return { headers, rows, fileName };
}

function extractInferredTransactionTable(
  matrix: string[][],
  fileName: string
): ParsedMigrationLearnerTable | null {
  const start = findTransactionDataStart(matrix);
  if (start === null) return null;

  const width = Math.max(
    maxRowWidth(matrix, start),
    INFERRED_TRANSACTION_HEADERS.length
  );
  const headers = INFERRED_TRANSACTION_HEADERS.slice(0, width);
  while (headers.length < width) {
    headers.push(`Column ${headers.length + 1}`);
  }

  const rows: Record<string, string>[] = [];
  for (let i = start; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    if (!looksLikeTransactionDataRow(cells) && !isNumericIndexCell(String(cells[0] ?? ""))) {
      continue;
    }
    if (!looksLikeTransactionDataRow(cells)) continue;
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = String(cells[idx] ?? "").trim();
    });
    rows.push(row);
  }

  if (rows.length === 0) return null;
  return { headers, rows, fileName };
}

/**
 * Extract tabular preview data from Kid-e-Sys report-style spreadsheets.
 * Returns null when the sheet should use default parsing.
 */
export function extractKideesysReportTable(
  matrix: string[][],
  fileName: string
): ParsedMigrationLearnerTable | null {
  if (!matrix.length) return null;

  const classList = normalizeKidESysLearnerClassListSheet(matrix, fileName);
  if (classList) return classList;

  const contactList = normalizeKidESysContactListSheet(matrix, fileName);
  if (contactList) return contactList;

  const headerRowIndex = findBestHeaderRowIndex(matrix);
  if (headerRowIndex !== null) {
    const fromHeader = extractFromHeaderRow(matrix, headerRowIndex, fileName);
    if (fromHeader && fromHeader.rows.length > 0) return fromHeader;
  }

  if (isTransactionExportFilename(fileName)) {
    const inferred = extractInferredTransactionTable(matrix, fileName);
    if (inferred) return inferred;
  }

  const firstData = findTransactionDataStart(matrix);
  if (firstData !== null) {
    const inferred = extractInferredTransactionTable(matrix, fileName);
    if (inferred) return inferred;
  }

  return null;
}
