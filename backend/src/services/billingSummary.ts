import { isKidESysSourceAccountRef } from "./daSilvaMigration/ageAnalysisParser";

/** Kid-e-Sys Statements overview targets (Da Silva — latest age-analysis import). */
export const DA_SILVA_KIDESYS_SUMMARY_TARGETS: BillingSummaryTotals = {
  accountsCount: 344,
  totalOutstanding: 1228655.42,
  recentlyOwing: 804945,
  badDebt: 914065.45,
  overPaid: -490355.03,
};

/** Build Kid-e-Sys overview card targets from parsed age-analysis rows. */
export function buildKidesysSummaryTargetsFromAgeAnalysis(
  accounts: Array<{ balance?: unknown; section?: unknown; kidesysSection?: unknown }>
): BillingSummaryTotals {
  let totalOutstanding = 0;
  let recentlyOwing = 0;
  let badDebt = 0;
  let overPaid = 0;
  for (const account of accounts) {
    const balance = roundBillingMoney(account.balance);
    totalOutstanding += balance;
    const section = normalizeKidesysBillingSection(account.kidesysSection ?? account.section);
    if (section === KIDESYS_BILLING_SECTION.RECENTLY_OWING) recentlyOwing += balance;
    if (section === KIDESYS_BILLING_SECTION.BAD_DEBT) badDebt += balance;
    if (section === KIDESYS_BILLING_SECTION.OVER_PAID) overPaid += balance;
  }
  return {
    accountsCount: accounts.length,
    totalOutstanding: roundBillingMoney(totalOutstanding),
    recentlyOwing: roundBillingMoney(recentlyOwing),
    badDebt: roundBillingMoney(badDebt),
    overPaid: roundBillingMoney(overPaid),
  };
}

export const KIDESYS_BILLING_SECTION = {
  RECENTLY_OWING: "Recently Owing",
  BAD_DEBT: "Bad Debt",
  PAID_UP: "Paid Up",
  OVER_PAID: "Over Paid",
  UP_TO_DATE: "Up To Date",
  INACTIVE: "Inactive",
} as const;

const SECTION_ALIASES: Record<string, string> = {
  recentlyowing: KIDESYS_BILLING_SECTION.RECENTLY_OWING,
  baddebt: KIDESYS_BILLING_SECTION.BAD_DEBT,
  paidup: KIDESYS_BILLING_SECTION.PAID_UP,
  overpaid: KIDESYS_BILLING_SECTION.OVER_PAID,
  uptodate: KIDESYS_BILLING_SECTION.UP_TO_DATE,
  inactive: KIDESYS_BILLING_SECTION.INACTIVE,
};

export type BillingSummaryRow = {
  accountNo?: string;
  balance?: unknown;
  kidesysSection?: unknown;
  status?: unknown;
};

export type BillingSummaryTotals = {
  accountsCount: number;
  totalOutstanding: number;
  recentlyOwing: number;
  badDebt: number;
  overPaid: number;
};

export type BillingSummaryValidationReport = {
  schoolId: string;
  generatedAt: string;
  targets: typeof DA_SILVA_KIDESYS_SUMMARY_TARGETS;
  actual: BillingSummaryTotals;
  variance: {
    accounts: number;
    totalOutstanding: number;
    recentlyOwing: number;
    badDebt: number;
    overPaid: number;
  };
  matches: {
    accounts: boolean;
    totalOutstanding: boolean;
    recentlyOwing: boolean;
    badDebt: boolean;
    overPaid: boolean;
  };
  passed: boolean;
  includedAccounts: Array<{
    accountNo: string;
    balance: number;
    kidesysSection: string;
    status: string;
  }>;
  excludedAccounts: Array<{
    accountNo: string;
    reason: string;
  }>;
  accountsInTargetsNotInSummary: string[];
  sectionBreakdown: Record<
    string,
    { count: number; balanceTotal: number }
  >;
};

export function roundBillingMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function normalizeKidesysBillingSection(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SECTION_ALIASES[key]) return SECTION_ALIASES[key];
  const known = Object.values(KIDESYS_BILLING_SECTION);
  const hit = known.find((s) => s.toLowerCase() === raw.toLowerCase());
  return hit || raw;
}

const KIDESYS_SUMMARY_SECTIONS = new Set<string>(Object.values(KIDESYS_BILLING_SECTION));

/** Summary cards: prefer live status (post-import), then age-analysis section. */
export function resolveRowKidesysSection(row: BillingSummaryRow): string {
  const fromStatus = normalizeKidesysBillingSection(row?.status);
  if (fromStatus && KIDESYS_SUMMARY_SECTIONS.has(fromStatus)) return fromStatus;
  const fromField = normalizeKidesysBillingSection(row?.kidesysSection);
  if (fromField) return fromField;
  return "";
}

export function isSummaryEligibleBillingRow(row: BillingSummaryRow): boolean {
  const accountNo = String(row?.accountNo ?? "").trim();
  if (!accountNo || accountNo === "-") return false;
  return isKidESysSourceAccountRef(accountNo);
}

/**
 * Kid-e-Sys overview card math (FamilyAccount / statement row balances):
 * - Accounts: all Kid-e-Sys billing rows
 * - Total Outstanding: net sum of balances
 * - Recently Owing / Bad Debt / Over Paid: sum balances in that age-analysis section (Over Paid signed)
 */
export function calculateBillingSummary(rows: BillingSummaryRow[]): BillingSummaryTotals {
  const included = (rows || []).filter(isSummaryEligibleBillingRow);
  const balance = (row: BillingSummaryRow) => roundBillingMoney(row?.balance);
  const section = (row: BillingSummaryRow) => resolveRowKidesysSection(row);

  const sumSection = (label: string) =>
    roundBillingMoney(
      included
        .filter((row) => section(row) === label)
        .reduce((sum, row) => sum + balance(row), 0)
    );

  return {
    accountsCount: included.length,
    totalOutstanding: roundBillingMoney(included.reduce((sum, row) => sum + balance(row), 0)),
    recentlyOwing: sumSection(KIDESYS_BILLING_SECTION.RECENTLY_OWING),
    badDebt: sumSection(KIDESYS_BILLING_SECTION.BAD_DEBT),
    overPaid: sumSection(KIDESYS_BILLING_SECTION.OVER_PAID),
  };
}

export function buildBillingSummaryValidationReport(
  schoolId: string,
  rows: BillingSummaryRow[],
  opts: {
    targets?: typeof DA_SILVA_KIDESYS_SUMMARY_TARGETS;
    expectedAccountRefs?: string[];
  } = {}
): BillingSummaryValidationReport {
  const targets = opts.targets ?? DA_SILVA_KIDESYS_SUMMARY_TARGETS;
  const actual = calculateBillingSummary(rows);
  const tolerance = 0.02;

  const includedAccounts: BillingSummaryValidationReport["includedAccounts"] = [];
  const excludedAccounts: BillingSummaryValidationReport["excludedAccounts"] = [];
  const sectionBreakdown: BillingSummaryValidationReport["sectionBreakdown"] = {};

  for (const row of rows || []) {
    const accountNo = String(row?.accountNo ?? "").trim();
    if (!accountNo) {
      excludedAccounts.push({ accountNo: "-", reason: "missing accountNo" });
      continue;
    }
    if (!isSummaryEligibleBillingRow(row)) {
      excludedAccounts.push({
        accountNo,
        reason: "not a Kid-e-Sys accountRef",
      });
      continue;
    }
    const kidesysSection = resolveRowKidesysSection(row);
    const balance = roundBillingMoney(row?.balance);
    includedAccounts.push({
      accountNo,
      balance,
      kidesysSection,
      status: String(row?.status ?? "").trim(),
    });
    const bucket = sectionBreakdown[kidesysSection || "(no section)"] || {
      count: 0,
      balanceTotal: 0,
    };
    bucket.count += 1;
    bucket.balanceTotal = roundBillingMoney(bucket.balanceTotal + balance);
    sectionBreakdown[kidesysSection || "(no section)"] = bucket;
  }

  const summaryRefs = new Set(
    includedAccounts.map((a) => a.accountNo.trim().toUpperCase())
  );
  const accountsInTargetsNotInSummary = (opts.expectedAccountRefs || [])
    .map((r) => String(r || "").trim().toUpperCase())
    .filter((ref) => ref && !summaryRefs.has(ref));

  const variance = {
    accounts: actual.accountsCount - targets.accountsCount,
    totalOutstanding: roundBillingMoney(actual.totalOutstanding - targets.totalOutstanding),
    recentlyOwing: roundBillingMoney(actual.recentlyOwing - targets.recentlyOwing),
    badDebt: roundBillingMoney(actual.badDebt - targets.badDebt),
    overPaid: roundBillingMoney(actual.overPaid - targets.overPaid),
  };

  const matches = {
    accounts: actual.accountsCount === targets.accountsCount,
    totalOutstanding: Math.abs(variance.totalOutstanding) < tolerance,
    recentlyOwing: Math.abs(variance.recentlyOwing) < tolerance,
    badDebt: Math.abs(variance.badDebt) < tolerance,
    overPaid: Math.abs(variance.overPaid) < tolerance,
  };

  return {
    schoolId,
    generatedAt: new Date().toISOString(),
    targets,
    actual,
    variance,
    matches,
    passed: Object.values(matches).every(Boolean),
    includedAccounts: includedAccounts.sort((a, b) => a.accountNo.localeCompare(b.accountNo)),
    excludedAccounts,
    accountsInTargetsNotInSummary,
    sectionBreakdown,
  };
}
