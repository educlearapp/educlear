import type { BillingSettingsState, CheckboxMap } from "../types/billingSettings";

export const ACCOUNT_STYLE_OPTIONS = ["Account", "Oldest Child"] as const;
export const GENERAL_SHOW_AMOUNTS_OPTIONS = [
  "Debit, Credit, Balance",
  "Debit, Credit",
  "Debit, Credit, Outstanding",
  "Amount, Balance",
  "Amount, Outstanding",
  "Amount, Outstanding, Balance",
] as const;
export const STATEMENT_SHOW_AMOUNTS_OPTIONS = ["Inclusive", "Exclusive", "Both"] as const;
export const STATEMENT_LAYOUT_OPTIONS = ["Standard", "Compact", "Detailed"] as const;
export const STATEMENT_HISTORY_OPTIONS = ["Full History", "Recent Only", "Summary Only"] as const;
export const DEFAULT_INVOICE_PAGE_OPTIONS = ["Standard Invoice", "Compact Invoice", "Detailed Invoice"] as const;
export const INVOICE_LAYOUT_OPTIONS = ["Standard", "Compact", "Detailed"] as const;
export const DUE_DATE_OPTIONS = ["Invoice Date", "End of Month", "Custom"] as const;
export const DEFAULT_PAYMENT_PAGE_OPTIONS = ["Standard Receipt", "Compact Receipt", "Detailed Receipt"] as const;
export const RECEIPT_LAYOUT_OPTIONS = ["Standard", "Compact", "Detailed"] as const;

export const QUICK_POPUP_OPTIONS = [
  { id: "quickPayment", label: "Quick Payment" },
  { id: "quickInvoice", label: "Quick Invoice" },
  { id: "quickAccountLookup", label: "Account Lookup" },
] as const;

export const ACCOUNTS_INFO_BLOCK_OPTIONS = [
  { id: "accountNumber", label: "Account Number" },
  { id: "balanceSummary", label: "Balance Summary" },
  { id: "contactDetails", label: "Contact Details" },
  { id: "classroomInfo", label: "Classroom" },
] as const;

export const INVOICES_INFO_BLOCK_OPTIONS = [
  { id: "invoiceHistory", label: "Invoice History" },
  { id: "feeBreakdown", label: "Fee Breakdown" },
  { id: "dueAmount", label: "Due Amount" },
] as const;

export const PAYMENTS_INFO_BLOCK_OPTIONS = [
  { id: "paymentHistory", label: "Payment History" },
  { id: "allocationDetails", label: "Allocation Details" },
  { id: "receiptLink", label: "Receipt Link" },
] as const;

export const CORRECTIONS_OPTIONS = [
  { id: "invoiceCorrections", label: "Invoice Corrections" },
  { id: "paymentCorrections", label: "Payment Corrections" },
  { id: "accountAdjustments", label: "Account Adjustments" },
] as const;

export const STATEMENT_INFO_OPTIONS = [
  { id: "openingBalance", label: "Opening Balance" },
  { id: "transactionHistory", label: "Transaction History" },
  { id: "agingSummary", label: "Aging Summary" },
  { id: "accountMessages", label: "Account Messages" },
] as const;

function checkboxDefaults(ids: readonly { id: string }[]): CheckboxMap {
  return Object.fromEntries(ids.map((item) => [item.id, false]));
}

export function createDefaultBillingSettings(): BillingSettingsState {
  return {
    general: {
      accountStyle: ACCOUNT_STYLE_OPTIONS[0],
      showAmounts: GENERAL_SHOW_AMOUNTS_OPTIONS[5],
      quickPopups: checkboxDefaults(QUICK_POPUP_OPTIONS),
      accountsInfoBlocks: checkboxDefaults(ACCOUNTS_INFO_BLOCK_OPTIONS),
      invoicesInfoBlocks: checkboxDefaults(INVOICES_INFO_BLOCK_OPTIONS),
      paymentsInfoBlocks: checkboxDefaults(PAYMENTS_INFO_BLOCK_OPTIONS),
      corrections: checkboxDefaults(CORRECTIONS_OPTIONS),
    },
    statement: {
      statementLayout: STATEMENT_LAYOUT_OPTIONS[0],
      statementHistory: STATEMENT_HISTORY_OPTIONS[0],
      statementInfo: checkboxDefaults(STATEMENT_INFO_OPTIONS),
      showAmounts: STATEMENT_SHOW_AMOUNTS_OPTIONS[0],
      displayOnStatement: {
        schoolName: false,
        schoolLogo: false,
        payingAddress: false,
        childClassroom: false,
      },
      standardMessage: "",
      standardEmailSubject: "",
      standardEmailMessage: "",
      standardSmsMessage: "",
    },
    invoice: {
      defaultInvoicePage: DEFAULT_INVOICE_PAGE_OPTIONS[0],
      invoiceLayout: INVOICE_LAYOUT_OPTIONS[0],
      displayOnInvoice: {
        schoolName: false,
        schoolLogo: false,
        dueDate: false,
        payingAddress: false,
        childClassroom: false,
      },
      dueDate: DUE_DATE_OPTIONS[0],
      standardMessage: "",
      standardEmailSubject: "",
      standardEmailMessage: "",
      standardSmsMessage: "",
    },
    receipt: {
      defaultPaymentPage: DEFAULT_PAYMENT_PAGE_OPTIONS[0],
      receiptLayout: RECEIPT_LAYOUT_OPTIONS[0],
      displayOnReceipt: {
        schoolName: false,
        schoolLogo: false,
      },
      standardMessage: "",
      standardEmailSubject: "",
      standardEmailMessage: "",
      standardSmsMessage: "",
    },
  };
}
