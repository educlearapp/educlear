/**
 * Helpers for completed (ledger-backed) invoice-run manage + Print Statements.
 * Keeps InvoiceRuns.tsx free of detail-mapping / empty-print edge cases.
 */
import type { InvoiceRunListRow } from "./invoiceRunList";

export type InvoiceRunDetailInvoice = {
  id: string;
  learnerId: string;
  billedLearnerId?: string;
  accountNo: string;
  familyAccountId?: string;
  amount: number;
  date: string;
  dueDate?: string;
  reference: string;
  description: string;
  invoicePeriod?: string;
  runId?: string;
};

export type InvoiceRunFamilyAccountSummary = {
  key: string;
  accountNo: string;
  familyAccountId?: string;
  learnerIds: string[];
  invoiceCount: number;
  invoiceAmount: number;
  anchorLearnerId: string;
};

export type InvoiceRunCompletedDetail = {
  schoolId: string;
  runId: string;
  description: string;
  invoicePeriod: string;
  period: string;
  invoiceDate: string;
  dueDate: string;
  totalInvoices: number;
  totalAmount: number;
  uniqueFamilyAccountCount: number;
  invoices: InvoiceRunDetailInvoice[];
  familyAccounts: InvoiceRunFamilyAccountSummary[];
  statementCutoffNote?: string;
};

/** Ledger-backed / already-executed runs need server detail because thin drafts strip rows. */
export function shouldLoadCompletedInvoiceRunDetail(
  run: InvoiceRunListRow | Record<string, unknown> | null | undefined
): boolean {
  if (!run || typeof run !== "object") return false;
  const runId = String((run as InvoiceRunListRow).runId || (run as InvoiceRunListRow).id || "").trim();
  if (!runId) return false;
  if (String((run as InvoiceRunListRow).source || "") === "ledger") return true;
  if ((run as InvoiceRunListRow).executed === true) return true;
  return Number((run as InvoiceRunListRow).totalInvoices || 0) > 0;
}

export function mapInvoiceRunDetailToManageRows(
  detail: InvoiceRunCompletedDetail | null | undefined
): Array<Record<string, unknown>> {
  const invoices = Array.isArray(detail?.invoices) ? detail!.invoices : [];
  return invoices.map((invoice, index) => {
    const learnerId = String(invoice.billedLearnerId || invoice.learnerId || "").trim();
    return {
      id: learnerId || invoice.id || `invoice-${index}`,
      learnerId,
      learnerName: "",
      accountNo: String(invoice.accountNo || ""),
      familyAccountId: invoice.familyAccountId,
      invoiceNo: String(invoice.reference || invoice.id || ""),
      statementNo: `ST${String(index + 1).padStart(4, "0")}`,
      invoiceAmount: Number(invoice.amount || 0),
      invoiceDate: String(invoice.date || ""),
      dueDate: String(invoice.dueDate || ""),
      description: String(invoice.description || ""),
      status: "Invoiced",
      parentName: "",
      parentEmail: "",
    };
  });
}

export function mapInvoiceRunFamilyAccountsToStatementRows(
  detail: InvoiceRunCompletedDetail | null | undefined
): Array<Record<string, unknown>> {
  const accounts = Array.isArray(detail?.familyAccounts) ? detail!.familyAccounts : [];
  return accounts.map((account, index) => ({
    id: account.key || account.accountNo || `family-${index}`,
    learnerId: account.anchorLearnerId,
    learnerIds: account.learnerIds,
    learnerName:
      account.learnerIds.length > 1
        ? `${account.learnerIds.length} learners`
        : account.anchorLearnerId || "Family account",
    accountNo: account.accountNo,
    familyAccountId: account.familyAccountId,
    statementNo: `ST${String(index + 1).padStart(4, "0")}`,
    invoiceAmount: Number(account.invoiceAmount || 0),
    invoiceCount: account.invoiceCount,
    status: "Statement",
    parentName: "",
    parentEmail: "",
  }));
}

export function canLaunchInvoiceRunPrint(recordCount: number): boolean {
  return Number(recordCount || 0) > 0;
}

export function invoiceRunPrintEmptyMessage(kind: "invoices" | "statements"): string {
  return kind === "statements"
    ? "No family account statements found to print for this invoice run."
    : "No invoices found to print for this invoice run.";
}
