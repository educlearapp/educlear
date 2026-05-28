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

export {
  formatMoney,
  normaliseBillingAmount,
  getBillingRows,
  calculateAccountBalance,
  getLastInvoice,
  getLastPayment,
  getAccountLedger,
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
  netOutstanding: number;
  recentlyOwing: number;
  badDebt: number;
  overPaid: number;
};

export const calculateBillingSummary = (rows: any[]): BillingSummaryTotals => {
  const rowBalance = (row: any) => normaliseBillingAmount(row?.balance);

  return {
    accountsCount: rows.length,
    netOutstanding: rows.reduce((sum, row) => sum + rowBalance(row), 0),
    recentlyOwing: rows
      .filter((row) => row.status === "Recently Owing")
      .reduce((sum, row) => sum + rowBalance(row), 0),
    badDebt: rows
      .filter((row) => row.status === "Bad Debt")
      .reduce((sum, row) => sum + rowBalance(row), 0),
    overPaid: Math.abs(
      rows
        .filter((row) => row.status === "Over Paid")
        .reduce((sum, row) => sum + rowBalance(row), 0)
    ),
  };
};

export const buildBillingAccountRows = (learners: any[], invoices: any[], payments: any[]) => {
  const schoolId = localStorage.getItem("schoolId") || "";
  if (schoolId) return getBillingRows(learners, schoolId);
  return [];
};
