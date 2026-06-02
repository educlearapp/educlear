import type { Invoice, Payment } from "./billingTypes";
import {
  calculateAccountBalance,
  formatMoney,
  getBillingRows,
  getLastInvoice,
  getLastPayment,
  normaliseBillingAmount,
  readSchoolLedger,
  getAccountLedger,
  entryMatchesAccount,
} from "./billingLedger";
import { isKidESysAccountRef } from "./billingAccountRef";

export {
  formatMoney,
  normaliseBillingAmount,
  getBillingRows,
  calculateAccountBalance,
  getLastInvoice,
  getLastPayment,
  getAccountLedger,
};

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

const getLearnerKey = (value: any) =>
  String(value?.learnerId || value?.learnerID || value?.learner?.id || value?.id || value?.accountNo || "").trim();

export const calculateOutstandingBalance = (
  invoices: Invoice[],
  payments: Payment[],
  learnerId: string,
  accountNo = ""
) => {
  const key = String(learnerId || "").trim();
  const invoiceTotal = invoices
    .filter((invoice: any) => {
      const invKey = getLearnerKey(invoice);
      return invKey === key || (accountNo && invKey === accountNo);
    })
    .reduce((total, invoice: any) => total + normaliseBillingAmount(invoice.amount || invoice.total || invoice.balance), 0);

  const paymentTotal = payments
    .filter((payment: any) => {
      const payKey = getLearnerKey(payment);
      return payKey === key || (accountNo && payKey === accountNo);
    })
    .reduce((total, payment: any) => total + normaliseBillingAmount(payment.amount), 0);

  return invoiceTotal - paymentTotal;
};

export const calculateLastPayment = (payments: Payment[], learnerId: string, accountNo = "") => {
  const key = String(learnerId || "").trim();
  const learnerPayments = payments
    .filter((payment: any) => {
      const payKey = getLearnerKey(payment);
      return payKey === key || (accountNo && payKey === accountNo);
    })
    .sort(
      (a: any, b: any) =>
        new Date(b.paymentDate || b.date || b.createdAt || 0).getTime() -
        new Date(a.paymentDate || a.date || a.createdAt || 0).getTime()
    );
  return learnerPayments[0] || null;
};

export type BillingSummaryTotals = {
  accountsCount: number;
  /** Net sum of all FamilyAccount statement balances (Kid-e-Sys Total Outstanding). */
  totalOutstanding: number;
  /** @deprecated Use totalOutstanding — kept for callers expecting netOutstanding. */
  netOutstanding: number;
  recentlyOwing: number;
  badDebt: number;
  /** Signed total for Over Paid section (negative when credits exceed debits). */
  overPaid: number;
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

export function resolveRowKidesysSection(row: any): string {
  const fromStatus = normalizeKidesysBillingSection(row?.status);
  if (fromStatus && KIDESYS_SUMMARY_SECTIONS.has(fromStatus)) return fromStatus;
  const fromField = normalizeKidesysBillingSection(row?.kidesysSection);
  if (fromField) return fromField;
  return "";
}

function isSummaryEligibleBillingRow(row: any): boolean {
  const accountNo = String(row?.accountNo ?? "").trim();
  if (!accountNo || accountNo === "-") return false;
  return isKidESysAccountRef(accountNo);
}

/** Kid-e-Sys overview cards — section totals use age-analysis section, not balance thresholds. */
export const calculateBillingSummary = (rows: any[]): BillingSummaryTotals => {
  const included = (rows || []).filter(isSummaryEligibleBillingRow);
  const rowBalance = (row: any) => roundBillingMoney(row?.balance);
  const section = (row: any) => resolveRowKidesysSection(row);

  const sumSection = (label: string) =>
    roundBillingMoney(
      included
        .filter((row) => section(row) === label)
        .reduce((sum, row) => sum + rowBalance(row), 0)
    );

  const totalOutstanding = roundBillingMoney(
    included.reduce((sum, row) => sum + rowBalance(row), 0)
  );

  return {
    accountsCount: included.length,
    totalOutstanding,
    netOutstanding: totalOutstanding,
    recentlyOwing: sumSection(KIDESYS_BILLING_SECTION.RECENTLY_OWING),
    badDebt: sumSection(KIDESYS_BILLING_SECTION.BAD_DEBT),
    overPaid: sumSection(KIDESYS_BILLING_SECTION.OVER_PAID),
  };
};

export const buildBillingAccountRows = (learners: any[], invoices: any[], payments: any[]) => {
  const schoolId = localStorage.getItem("schoolId") || "";
  if (schoolId) return getBillingRows(learners, schoolId);
  return [];
};
