import {
  isNumericIndexCell,
  normalizeMatchText,
  parseAmount,
  type KideesysSheet,
} from "../../utils/kideesysSpreadsheet";
import { splitMergedAccountNames } from "./daSilvaMergedFamily";
import type { ParsedBillingAccount } from "./parsers";

export function isKidESysSourceAccountRef(accountNo: string): boolean {
  const ref = String(accountNo || "").trim();
  if (!ref || ref.startsWith("KID-MISSING-")) return false;
  return KIDEESYS_ACCOUNT_CODE_RE.test(ref);
}

/** Map each learner name on an age-analysis row (including multi-line siblings) to accountNo. */
export function indexAgeAnalysisAccountNames(
  accounts: ParsedBillingAccount[],
  target: Map<string, string>
): void {
  for (const account of accounts) {
    target.set(normalizeMatchText(account.fullName), account.accountNo);
    const names = account.learnerNames?.length
      ? account.learnerNames
      : splitMergedAccountNames(account.fullName);
    for (const name of names) {
      if (!name) continue;
      target.set(normalizeMatchText(name), account.accountNo);
    }
  }
}

/** Kid-e-Sys debtor account codes (e.g. ALI002, RAM021). */
export const KIDEESYS_ACCOUNT_CODE_RE = /^[A-Z]{2,5}\d{2,5}$/i;

export type AgeAnalysisParseAudit = {
  ageAnalysisRowsParsed: number;
  accountNumbersParsed: number;
  accountsWithMultipleLearners: number;
  sectionLabels: string[];
  headerRowIndex: number | null;
  accountColumnIndex: number | null;
  nameColumnIndex: number | null;
  balanceColumnIndex: number | null;
  agingColumnIndexes: {
    current: number | null;
    d30: number | null;
    d60: number | null;
    d90: number | null;
    d120: number | null;
  };
  sampleAccountNumbers: string[];
};

export type AgeAnalysisParseResult = {
  accounts: ParsedBillingAccount[];
  audit: AgeAnalysisParseAudit;
};

function compactHeader(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function rowText(row: string[], index: number): string {
  return String(row[index] ?? "").trim();
}

function isAccountCode(value: string): boolean {
  return KIDEESYS_ACCOUNT_CODE_RE.test(String(value || "").trim());
}

function normalizeAccountCode(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function looksLikeAmountCell(value: string): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  return /^-?[\d,]+(\.\d+)?$/.test(v.replace(/,/g, ""));
}

function isSectionTitleRow(row: string[]): boolean {
  const nonEmpty = row.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (nonEmpty.length !== 1) return false;
  const cell = nonEmpty[0];
  if (cell === "Account") return false;
  if (isNumericIndexCell(cell)) return false;
  if (isAccountCode(cell)) return false;
  return true;
}

function isAgeAnalysisHeaderRow(row: string[]): boolean {
  const compact = row.map((c) => compactHeader(c));
  const hasAccount = compact.some((c) => c === "account");
  const hasBalance = compact.some((c) => c === "balance");
  return hasAccount && hasBalance;
}

type ColumnMap = {
  account: number;
  name: number;
  balance: number;
  current: number | null;
  d30: number | null;
  d60: number | null;
  d90: number | null;
  d120: number | null;
};

function findColumnIndex(row: string[], matchers: string[]): number | null {
  for (let i = 0; i < row.length; i++) {
    const key = compactHeader(row[i]);
    if (!key) continue;
    if (matchers.some((m) => key === m || key.startsWith(m))) return i;
  }
  return null;
}

function buildColumnMap(headerRow: string[]): ColumnMap | null {
  if (!isAgeAnalysisHeaderRow(headerRow)) return null;

  const account = findColumnIndex(headerRow, ["account"]);
  const balance = findColumnIndex(headerRow, ["balance"]);
  if (account === null || balance === null) return null;

  let name: number | null = null;
  for (let i = account + 1; i < balance; i++) {
    const cell = rowText(headerRow, i);
    if (!cell) {
      name = i;
      break;
    }
    const key = compactHeader(cell);
    if (key.includes("name") || key.includes("child") || key.includes("learner")) {
      name = i;
      break;
    }
  }
  if (name === null) {
    for (let i = account + 1; i < balance; i++) {
      if (!rowText(headerRow, i)) {
        name = i;
        break;
      }
    }
  }
  if (name === null) name = account + 1;

  const current = findColumnIndex(headerRow, ["current"]);
  const d30 = findColumnIndex(headerRow, ["30days", "30"]);
  const d60 = findColumnIndex(headerRow, ["60days", "60"]);
  const d90 = findColumnIndex(headerRow, ["90days", "90"]);
  const d120 = findColumnIndex(headerRow, ["120days", "120"]);

  return {
    account,
    name,
    balance,
    current,
    d30,
    d60,
    d90,
    d120,
  };
}

function findAccountInRow(row: string[], maxScan = 4): { index: number; value: string } | null {
  for (let i = 0; i < Math.min(row.length, maxScan); i++) {
    const cell = rowText(row, i);
    if (!cell || isNumericIndexCell(cell)) continue;
    if (isAccountCode(cell)) return { index: i, value: normalizeAccountCode(cell) };
  }
  return null;
}

function inferColumnMapFromSampleRow(row: string[]): ColumnMap | null {
  const accountHit = findAccountInRow(row);
  if (!accountHit) return null;

  const account = accountHit.index;
  let name = account + 1;
  let balance = name + 1;

  while (balance < row.length && !looksLikeAmountCell(rowText(row, balance))) {
    if (balance === name && rowText(row, name) && !looksLikeAmountCell(rowText(row, name))) {
      balance += 1;
      continue;
    }
    if (!rowText(row, balance)) {
      balance += 1;
      continue;
    }
    if (!looksLikeAmountCell(rowText(row, balance))) {
      name = balance;
      balance += 1;
      continue;
    }
    break;
  }

  if (balance >= row.length || !looksLikeAmountCell(rowText(row, balance))) return null;

  const readAmountAt = (idx: number | null): number | null => {
    if (idx === null || idx < 0 || idx >= row.length) return null;
    const v = rowText(row, idx);
    return looksLikeAmountCell(v) ? parseAmount(v) : null;
  };

  const amountCols: number[] = [];
  for (let i = balance; i < row.length; i++) {
    if (looksLikeAmountCell(rowText(row, i))) amountCols.push(i);
  }

  return {
    account,
    name,
    balance,
    current: amountCols[1] ?? null,
    d30: amountCols[2] ?? null,
    d60: amountCols[3] ?? null,
    d90: amountCols[4] ?? null,
    d120: amountCols[5] ?? null,
  };
}

function readAmount(row: string[], idx: number | null): number {
  if (idx === null || idx < 0) return 0;
  return parseAmount(rowText(row, idx));
}

function parseAccountDataRow(
  row: string[],
  columnMap: ColumnMap,
  section: string
): ParsedBillingAccount | null {
  const accountHit = findAccountInRow(row);
  if (!accountHit) return null;

  const accountNo = accountHit.value;
  const fullName = rowText(row, columnMap.name);
  const balance = readAmount(row, columnMap.balance);

  return {
    accountNo,
    fullName,
    balance,
    section: section || "General",
    current: readAmount(row, columnMap.current),
    d30: readAmount(row, columnMap.d30),
    d60: readAmount(row, columnMap.d60),
    d90: readAmount(row, columnMap.d90),
    d120: readAmount(row, columnMap.d120),
    learnerNames: splitMergedAccountNames(fullName),
  };
}

function emptyAudit(): AgeAnalysisParseAudit {
  return {
    ageAnalysisRowsParsed: 0,
    accountNumbersParsed: 0,
    accountsWithMultipleLearners: 0,
    sectionLabels: [],
    headerRowIndex: null,
    accountColumnIndex: null,
    nameColumnIndex: null,
    balanceColumnIndex: null,
    agingColumnIndexes: {
      current: null,
      d30: null,
      d60: null,
      d90: null,
      d120: null,
    },
    sampleAccountNumbers: [],
  };
}

/**
 * Parse Kid-e-Sys Account List (Age Analysis) — authoritative billing identity source.
 * Handles index column or account-first layouts, section rows, and multi-line learner names.
 */
export function parseAgeAnalysisSheet(sheet: KideesysSheet): AgeAnalysisParseResult {
  const audit = emptyAudit();
  const accounts: ParsedBillingAccount[] = [];
  let section = "General";
  let columnMap: ColumnMap | null = null;

  for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] || [];

    if (isSectionTitleRow(row)) {
      section = rowText(row, 0) || section;
      if (!audit.sectionLabels.includes(section)) audit.sectionLabels.push(section);
      continue;
    }

    if (!audit.headerRowIndex && isAgeAnalysisHeaderRow(row)) {
      const headerMap = buildColumnMap(row);
      audit.headerRowIndex = rowIndex;
      if (headerMap) {
        audit.agingColumnIndexes = {
          current: headerMap.current,
          d30: headerMap.d30,
          d60: headerMap.d60,
          d90: headerMap.d90,
          d120: headerMap.d120,
        };
      }
      continue;
    }

    const accountHit = findAccountInRow(row);
    if (!accountHit) continue;

    if (!columnMap) {
      columnMap = inferColumnMapFromSampleRow(row);
      if (columnMap) {
        audit.accountColumnIndex = columnMap.account;
        audit.nameColumnIndex = columnMap.name;
        audit.balanceColumnIndex = columnMap.balance;
        audit.agingColumnIndexes = {
          current: columnMap.current,
          d30: columnMap.d30,
          d60: columnMap.d60,
          d90: columnMap.d90,
          d120: columnMap.d120,
        };
      }
    }

    if (!columnMap) continue;

    const parsed = parseAccountDataRow(row, columnMap, section);
    if (!parsed) continue;

    audit.ageAnalysisRowsParsed += 1;
    accounts.push(parsed);
  }

  const accountNos = new Set(accounts.map((a) => a.accountNo));
  audit.accountNumbersParsed = accountNos.size;
  audit.sampleAccountNumbers = [...accountNos].sort().slice(0, 25);
  audit.accountsWithMultipleLearners = accounts.filter(
    (a) => (a.learnerNames?.length || splitMergedAccountNames(a.fullName).length) > 1
  ).length;

  return { accounts, audit };
}
