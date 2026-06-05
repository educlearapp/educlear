import fs from "fs";
import path from "path";

import { normalizeKidesysBillingSection } from "../billingSummary";
import { parseAgeAnalysisFileWithAudit } from "../daSilvaMigration/parsers";
import type { ParsedBillingAccount } from "../daSilvaMigration/parsers";
import type { FamilyAccountAgeAnalysisSnapshot } from "../../utils/familyAccountAgeAnalysisStore";

/** Post top-up import cutoff — preserves ledger payments without balance double-count. */
export const DA_SILVA_AGE_BASELINE_IMPORTED_AT = "2099-12-31T23:59:59.999Z";

export const DA_SILVA_EXTRA_AGE_ANALYSIS_ACCOUNTS: Array<{
  accountRef: string;
  accountHolder: string;
  kidesysSection: string;
  balance: number;
}> = [
  {
    accountRef: "JAC001",
    accountHolder: "Jason - Lee Jacobs",
    kidesysSection: "Paid Up",
    balance: -1050.02,
  },
  {
    accountRef: "LET007",
    accountHolder: "Otlotleng Letsholo",
    kidesysSection: "Paid Up",
    balance: 0,
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return round2(n);
}

export function findLatestAgeAnalysisXls(): string {
  const roots = [
    path.join(process.cwd(), "uploads", "migration-staging", "tmp"),
    path.join(process.cwd(), "storage", "migration-staging"),
  ];
  const hits: { file: string; mtime: number }[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const ent of fs.readdirSync(root)) {
      if (!/age_analysis/i.test(ent)) continue;
      const file = path.join(root, ent);
      if (!fs.statSync(file).isFile()) continue;
      hits.push({ file, mtime: fs.statSync(file).mtimeMs });
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  if (!hits.length) {
    throw new Error("No age_analysis.xls found under uploads/ or storage/");
  }
  return hits[0].file;
}

function snapshotFromParsedAccount(
  schoolId: string,
  account: ParsedBillingAccount,
  importedAt: string
): FamilyAccountAgeAnalysisSnapshot {
  const accountRef = String(account.accountNo || "").trim().toUpperCase();
  const accountHolder = String(account.fullName || "").trim() || accountRef;
  return {
    schoolId,
    accountRef,
    accountHolder,
    kidesysSection: normalizeKidesysBillingSection(account.section),
    balance: money(account.balance),
    buckets: {
      current: money(account.current),
      d30: money(account.d30),
      d60: money(account.d60),
      d90: money(account.d90),
      d120: money(account.d120),
    },
    source: "kideesys-age-analysis",
    importedAt,
  };
}

/** Exact per-account Kid-e-Sys Age Analysis balances — no proportional scaling. */
export function buildExactAgeAnalysisSnapshots(opts: {
  schoolId: string;
  ageAnalysisXls?: string;
  importedAt?: string;
  extraAccounts?: typeof DA_SILVA_EXTRA_AGE_ANALYSIS_ACCOUNTS;
}): {
  ageAnalysisXls: string;
  snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot>;
  parsedAccountCount: number;
} {
  const schoolId = String(opts.schoolId || "").trim();
  const ageAnalysisXls = opts.ageAnalysisXls?.trim() || findLatestAgeAnalysisXls();
  const importedAt = String(opts.importedAt || DA_SILVA_AGE_BASELINE_IMPORTED_AT).trim();
  const extraAccounts = opts.extraAccounts ?? DA_SILVA_EXTRA_AGE_ANALYSIS_ACCOUNTS;

  const { accounts } = parseAgeAnalysisFileWithAudit(ageAnalysisXls);
  const snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};

  for (const account of accounts) {
    const accountRef = String(account.accountNo || "").trim().toUpperCase();
    if (!accountRef) continue;
    snapshots[accountRef] = snapshotFromParsedAccount(schoolId, account, importedAt);
  }

  for (const extra of extraAccounts) {
    const accountRef = String(extra.accountRef || "").trim().toUpperCase();
    if (!accountRef) continue;
    snapshots[accountRef] = {
      schoolId,
      accountRef,
      accountHolder: extra.accountHolder,
      kidesysSection: normalizeKidesysBillingSection(extra.kidesysSection),
      balance: money(extra.balance),
      buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
      source: "kideesys-age-analysis",
      importedAt,
    };
  }

  return { ageAnalysisXls, snapshots, parsedAccountCount: accounts.length };
}

export type AgeAnalysisAccountMatchReport = {
  kidesysBalanceByAccount: Record<string, number>;
  eduClearBeforeByAccount: Record<string, number>;
  eduClearAfterByAccount: Record<string, number>;
  matchingExactly: string[];
  unmatched: Array<{
    accountNo: string;
    kidesysBalance: number;
    eduClearBefore: number;
    eduClearAfter: number;
    delta: number;
  }>;
};

export function compareExactAgeAnalysisBalances(opts: {
  kidesysBalanceByAccount: Record<string, number>;
  eduClearBalanceByAccount: Record<string, number>;
  tolerance?: number;
}): {
  matchingExactly: string[];
  unmatched: AgeAnalysisAccountMatchReport["unmatched"];
} {
  const tolerance = opts.tolerance ?? 0.01;
  const allAccounts = new Set([
    ...Object.keys(opts.kidesysBalanceByAccount),
    ...Object.keys(opts.eduClearBalanceByAccount),
  ]);
  const matchingExactly: string[] = [];
  const unmatched: AgeAnalysisAccountMatchReport["unmatched"] = [];

  for (const accountNo of Array.from(allAccounts).sort()) {
    const kidesysBalance = round2(Number(opts.kidesysBalanceByAccount[accountNo] ?? 0));
    const eduClearBalance = round2(Number(opts.eduClearBalanceByAccount[accountNo] ?? 0));
    if (Math.abs(kidesysBalance - eduClearBalance) <= tolerance) {
      matchingExactly.push(accountNo);
      continue;
    }
    unmatched.push({
      accountNo,
      kidesysBalance,
      eduClearBefore: eduClearBalance,
      eduClearAfter: eduClearBalance,
      delta: round2(eduClearBalance - kidesysBalance),
    });
  }

  return { matchingExactly, unmatched };
}
