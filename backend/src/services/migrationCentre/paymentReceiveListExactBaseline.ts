import { normalizeKidesysBillingSection } from "../billingSummary";
import type { FamilyAccountAgeAnalysisSnapshot } from "../../utils/familyAccountAgeAnalysisStore";
import {
  parsePaymentReceiveListPdf,
  type ParsedPaymentReceiveRow,
  type PaymentReceiveListParseAudit,
} from "../daSilvaMigration/paymentReceiveListParser";
import { DA_SILVA_AGE_BASELINE_IMPORTED_AT } from "./ageAnalysisExactBaseline";

export { DA_SILVA_AGE_BASELINE_IMPORTED_AT };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return round2(n);
}

function sectionFromBalance(balance: number): string {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

export type PaymentReceiveCardTotals = {
  totalAccounts: number;
  totalOutstanding: number;
  overPaid: number;
  netPosition: number;
  recentlyOwing: number;
  badDebt: number;
};

/** Top cards from exact PDF balances — no hardcoded targets. */
export function calculatePaymentReceiveCardTotals(
  balances: Array<{ balance: number }>
): PaymentReceiveCardTotals {
  let totalOutstanding = 0;
  let overPaid = 0;
  let netPosition = 0;
  let recentlyOwing = 0;
  let badDebt = 0;

  for (const row of balances) {
    const balance = money(row.balance);
    netPosition += balance;
    if (balance > 0) totalOutstanding += balance;
    if (balance < 0) overPaid += Math.abs(balance);
    const section = sectionFromBalance(balance);
    if (section === "Recently Owing") recentlyOwing += balance;
    if (section === "Bad Debt") badDebt += balance;
  }

  return {
    totalAccounts: balances.length,
    totalOutstanding: round2(totalOutstanding),
    overPaid: round2(overPaid),
    netPosition: round2(netPosition),
    recentlyOwing: round2(recentlyOwing),
    badDebt: round2(badDebt),
  };
}

function snapshotFromPaymentReceiveRow(
  schoolId: string,
  row: ParsedPaymentReceiveRow,
  importedAt: string
): FamilyAccountAgeAnalysisSnapshot {
  const accountRef = String(row.accountNo || "").trim().toUpperCase();
  const accountHolder = String(row.learnerName || "").trim() || accountRef;
  const balance = money(row.balance);
  return {
    schoolId,
    accountRef,
    accountHolder,
    kidesysSection: normalizeKidesysBillingSection(sectionFromBalance(balance)),
    balance,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    source: "kideesys-age-analysis",
    importedAt,
  };
}

export type ActiveFamilyAccountIndex = {
  activeAccountRefs: Set<string>;
  familyAccountCount: number;
  activeLearnerCount: number;
  historicalAccountRefs: Set<string>;
  pdfAccountsNotActive: string[];
  activeAccountsMissingFromPdf: string[];
};

/** Build exact baseline snapshots from Payment Receive List PDF balances only. */
export async function buildPaymentReceiveListSnapshots(opts: {
  schoolId: string;
  pdfPath: string;
  importedAt?: string;
  activeAccountRefs?: Set<string>;
}): Promise<{
  pdfPath: string;
  audit: PaymentReceiveListParseAudit;
  snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot>;
  pdfBalanceByAccount: Record<string, number>;
  cardTotals: PaymentReceiveCardTotals;
}> {
  const schoolId = String(opts.schoolId || "").trim();
  const importedAt = String(opts.importedAt || DA_SILVA_AGE_BASELINE_IMPORTED_AT).trim();
  const { uniqueByAccount, audit } = await parsePaymentReceiveListPdf(opts.pdfPath);

  const snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};
  const pdfBalanceByAccount: Record<string, number> = {};
  const activeRefs = opts.activeAccountRefs;

  for (const [acct, row] of Object.entries(uniqueByAccount)) {
    if (activeRefs && !activeRefs.has(acct)) continue;
    pdfBalanceByAccount[acct] = money(row.balance);
    snapshots[acct] = snapshotFromPaymentReceiveRow(schoolId, row, importedAt);
  }

  const cardTotals = calculatePaymentReceiveCardTotals(
    Object.entries(pdfBalanceByAccount).map(([accountNo, balance]) => ({ accountNo, balance }))
  );

  return {
    pdfPath: opts.pdfPath,
    audit,
    snapshots,
    pdfBalanceByAccount,
    cardTotals,
  };
}

export type PaymentReceiveVerificationRow = {
  accountNo: string;
  kidESysBalance: number;
  eduClearBalance: number;
  difference: number;
};

export function buildPaymentReceiveVerificationTable(opts: {
  pdfBalanceByAccount: Record<string, number>;
  eduClearBalanceByAccount: Record<string, number>;
  tolerance?: number;
}): {
  rows: PaymentReceiveVerificationRow[];
  matchingExactly: string[];
  notMatching: PaymentReceiveVerificationRow[];
} {
  const tolerance = opts.tolerance ?? 0.01;
  const allAccounts = new Set([
    ...Object.keys(opts.pdfBalanceByAccount),
    ...Object.keys(opts.eduClearBalanceByAccount),
  ]);

  const rows: PaymentReceiveVerificationRow[] = [];
  const matchingExactly: string[] = [];
  const notMatching: PaymentReceiveVerificationRow[] = [];

  for (const accountNo of Array.from(allAccounts).sort()) {
    const kidESysBalance = round2(Number(opts.pdfBalanceByAccount[accountNo] ?? 0));
    const eduClearBalance = round2(Number(opts.eduClearBalanceByAccount[accountNo] ?? 0));
    const difference = round2(eduClearBalance - kidESysBalance);
    const row = { accountNo, kidESysBalance, eduClearBalance, difference };
    rows.push(row);
    if (Math.abs(difference) <= tolerance) {
      matchingExactly.push(accountNo);
    } else {
      notMatching.push(row);
    }
  }

  return { rows, matchingExactly, notMatching };
}
