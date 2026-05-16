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

export const buildBillingAccountRows = (learners: any[], invoices: any[], payments: any[]) => {
  const schoolId = localStorage.getItem("schoolId") || "";
  if (schoolId) return getBillingRows(learners, schoolId);

  return learners.map((learner: any) => {
    const learnerId = String(learner?.id || learner?.learnerId || "").trim();
    const accountNo = String(learner?.accountNo || "").trim();
    const ledger = [...invoices, ...payments] as any[];
    const balance = calculateAccountBalance(
      ledger.filter((e) => entryMatchesAccount(e, learnerId, accountNo)) as any
    );
    const lastInv = getLastInvoice(ledger.filter((e) => e.type === "invoice") as any);
    const lastPay = getLastPayment(ledger.filter((e) => e.type === "payment") as any);

    return {
      id: learnerId,
      learnerId,
      accountNo,
      name: learner?.firstName || learner?.name || "",
      surname: learner?.surname || learner?.lastName || "",
      balance,
      lastInvoice: lastInv ? formatMoney(lastInv.amount) : "No invoices",
      lastInvoiceDate: lastInv?.date || "",
      lastPayment: lastPay ? `${formatMoney(lastPay.amount)} on ${lastPay.date || ""}` : "No payments",
      lastPaymentDate: lastPay?.date || "",
      status:
        balance > 10000 ? "Bad Debt" : balance > 0 ? "Recently Owing" : balance < 0 ? "Over Paid" : "Up To Date",
    };
  });
};
