/**
 * Opening-balance import safety: one source opening per family/account.
 * Same amount in a second file is skipped. Conflicting amounts fail closed.
 */

import { parseMoneyToCents } from "../finance/moneyCents";

export type OpeningBalanceSourceRow = {
  accountRef: string;
  openingBalance: unknown;
  sourceFileId?: string;
  sourceFilename?: string;
  rowNumber?: number;
};

export type CollapsedOpeningBalance = {
  accountRef: string;
  cents: number;
  sourceAmountLabel: string;
  status: "post" | "skip-duplicate" | "zero" | "conflict" | "invalid";
  message: string;
  sourceFilenames: string[];
  rowNumbers: number[];
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

function accountKey(value: unknown): string {
  return clean(value);
}

export function collapseOpeningBalancesByAccount(
  rows: OpeningBalanceSourceRow[]
): CollapsedOpeningBalance[] {
  const byAccount = new Map<
    string,
    {
      cents: number | null;
      invalid: boolean;
      filenames: string[];
      rowNumbers: number[];
      conflict: boolean;
    }
  >();

  for (const row of rows) {
    const accountRef = accountKey(row.accountRef);
    if (!accountRef) continue;
    if (row.openingBalance === undefined || row.openingBalance === null || clean(row.openingBalance) === "") {
      continue;
    }
    const cents = parseMoneyToCents(row.openingBalance);
    const current = byAccount.get(accountRef) || {
      cents: null,
      invalid: false,
      filenames: [],
      rowNumbers: [],
      conflict: false,
    };
    if (row.sourceFilename) current.filenames.push(row.sourceFilename);
    if (row.rowNumber) current.rowNumbers.push(row.rowNumber);
    if (cents === null) {
      current.invalid = true;
    } else if (current.cents === null) {
      current.cents = cents;
    } else if (current.cents !== cents) {
      current.conflict = true;
    }
    byAccount.set(accountRef, current);
  }

  const out: CollapsedOpeningBalance[] = [];
  for (const [accountRef, info] of byAccount) {
    if (info.invalid && info.cents === null) {
      out.push({
        accountRef,
        cents: 0,
        sourceAmountLabel: "",
        status: "invalid",
        message: "Opening balance amount could not be parsed",
        sourceFilenames: info.filenames,
        rowNumbers: info.rowNumbers,
      });
      continue;
    }
    if (info.conflict) {
      out.push({
        accountRef,
        cents: info.cents ?? 0,
        sourceAmountLabel: info.cents != null ? (info.cents / 100).toFixed(2) : "",
        status: "conflict",
        message:
          "REVIEW REQUIRED. This account has more than one opening/current balance in the export set. Do not post until the source amount is unique.",
        sourceFilenames: info.filenames,
        rowNumbers: info.rowNumbers,
      });
      continue;
    }
    const cents = info.cents ?? 0;
    if (cents === 0) {
      out.push({
        accountRef,
        cents: 0,
        sourceAmountLabel: "0.00",
        status: "zero",
        message: "Zero opening balance — nothing to post",
        sourceFilenames: info.filenames,
        rowNumbers: info.rowNumbers,
      });
      continue;
    }
    const extraFiles = new Set(info.filenames).size > 1 || info.rowNumbers.length > 1;
    out.push({
      accountRef,
      cents,
      sourceAmountLabel: (cents / 100).toFixed(2),
      status: extraFiles ? "skip-duplicate" : "post",
      message: extraFiles
        ? "Opening balance already present for this source account — import once only"
        : "Post opening balance once for this source account",
      sourceFilenames: info.filenames,
      rowNumbers: info.rowNumbers,
    });
  }
  return out;
}

export function openingBalanceRowsToPost(
  rows: OpeningBalanceSourceRow[]
): { toPost: OpeningBalanceSourceRow[]; skipped: CollapsedOpeningBalance[]; failed: CollapsedOpeningBalance[] } {
  const collapsed = collapseOpeningBalancesByAccount(rows);
  const firstByAccount = new Map<string, OpeningBalanceSourceRow>();
  for (const row of rows) {
    const ref = accountKey(row.accountRef);
    if (!ref || firstByAccount.has(ref)) continue;
    if (row.openingBalance === undefined || clean(row.openingBalance) === "") continue;
    firstByAccount.set(ref, row);
  }

  const toPost: OpeningBalanceSourceRow[] = [];
  const skipped: CollapsedOpeningBalance[] = [];
  const failed: CollapsedOpeningBalance[] = [];
  for (const item of collapsed) {
    if (item.status === "conflict" || item.status === "invalid") {
      failed.push(item);
      continue;
    }
    if (item.status === "zero") {
      skipped.push(item);
      continue;
    }
    const first = firstByAccount.get(item.accountRef);
    if (first) toPost.push(first);
    if (item.status === "skip-duplicate") {
      skipped.push({
        ...item,
        message: "Same source opening appeared more than once — posting the first occurrence only",
      });
    }
  }
  return { toPost, skipped, failed };
}
