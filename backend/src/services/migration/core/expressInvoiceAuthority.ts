/**
 * Fly Eagle / Express Invoice export authority map.
 * Based on local sample headers (reference only — never imports production data).
 *
 * EXPRESS INVOICE (A)  — customer master / contacts
 * EXPRESS INVOICE (B)  — full customer list + current balance
 * EXPRESS UNPAID ACCOUNTS — outstanding balances (corroborates B)
 * EXPRESS INVOICE REPORT — invoice register
 * EXPRESS INVOICE CC / (C) — payment receipts (often overlapping)
 * EXPRESS - ITEM SALES REPORT — item totals, no customer
 */

import type { MigrationFileCategory } from "../types/MigrationFile";
import type { MigrationTargetField } from "../types/MigrationTargetField";

export type ExpressInvoiceExportKind =
  | "INVOICE_REPORT"
  | "INVOICE_A"
  | "INVOICE_B"
  | "INVOICE_C"
  | "INVOICE_CC"
  | "UNPAID_ACCOUNTS"
  | "ITEM_SALES"
  | "NOT_EXPRESS";

export type ExpressInvoiceAuthorityRole =
  | "customer-account-identity"
  | "learner-customer-names"
  | "invoices"
  | "payments"
  | "unpaid-current-balance"
  | "invoice-lines-items"
  | "overlapping-history-only";

export type ExpressInvoiceAuthority = {
  kind: ExpressInvoiceExportKind;
  category: MigrationFileCategory;
  label: string;
  trustedFor: ExpressInvoiceAuthorityRole[];
  notTrustedFor: ExpressInvoiceAuthorityRole[];
  overlap: string;
  autoPostTransactions: boolean;
  columnMappings: Array<{ sourceColumn: string; targetField: MigrationTargetField }>;
};

function compact(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function classifyExpressInvoiceExport(filename: string): ExpressInvoiceExportKind {
  const hay = compact(filename);
  if (!hay.includes("express")) return "NOT_EXPRESS";

  if (hay.includes("unpaidaccount") || hay.includes("unpaidaccounts")) return "UNPAID_ACCOUNTS";
  if (hay.includes("itemsales") || (hay.includes("item") && hay.includes("sales"))) return "ITEM_SALES";
  if (hay.includes("invoicecc") || hay.includes("expressinvoicecc")) return "INVOICE_CC";
  if (hay.includes("invoicea") || hay.includes("expressinvoicea")) return "INVOICE_A";
  if (hay.includes("invoiceb") || hay.includes("expressinvoiceb")) return "INVOICE_B";
  if ((hay.includes("invoicec") || hay.includes("expressinvoicec")) && !hay.includes("invoicecc")) {
    return "INVOICE_C";
  }
  if (hay.includes("invoicereport") || hay.includes("expressinvoicereport")) return "INVOICE_REPORT";
  if (hay.includes("invoice")) return "INVOICE_REPORT";
  return "NOT_EXPRESS";
}

const AUTHORITY: Record<Exclude<ExpressInvoiceExportKind, "NOT_EXPRESS">, ExpressInvoiceAuthority> = {
  INVOICE_REPORT: {
    kind: "INVOICE_REPORT",
    category: "transactions",
    label: "EXPRESS INVOICE REPORT",
    trustedFor: ["invoices", "customer-account-identity", "learner-customer-names"],
    notTrustedFor: ["unpaid-current-balance", "invoice-lines-items"],
    overlap:
      "Invoice register (Date, Invoice, Customer, Status, Amount). Deduplicate by invoice number across overlapping extracts.",
    autoPostTransactions: true,
    columnMappings: [
      { sourceColumn: "Date", targetField: "transactionDate" },
      { sourceColumn: "Invoice", targetField: "reference" },
      { sourceColumn: "Customer", targetField: "accountNumber" },
      { sourceColumn: "Status", targetField: "transactionType" },
      { sourceColumn: "Amount", targetField: "amount" },
    ],
  },
  INVOICE_A: {
    kind: "INVOICE_A",
    category: "parents",
    label: "EXPRESS INVOICE (A)",
    trustedFor: ["customer-account-identity", "learner-customer-names"],
    notTrustedFor: ["invoices", "payments", "unpaid-current-balance", "invoice-lines-items"],
    overlap: "Customer master (name, contact, address, phone). Not a balance or invoice register.",
    autoPostTransactions: false,
    columnMappings: [
      { sourceColumn: "Customer", targetField: "accountNumber" },
      { sourceColumn: "Contact", targetField: "relationship" },
      { sourceColumn: "FirstName", targetField: "parentName" },
      { sourceColumn: "Address", targetField: "address" },
      { sourceColumn: "Phone", targetField: "parentPhone" },
      { sourceColumn: "EMail", targetField: "parentEmail" },
    ],
  },
  INVOICE_B: {
    kind: "INVOICE_B",
    category: "billing",
    label: "EXPRESS INVOICE (B)",
    trustedFor: ["customer-account-identity", "learner-customer-names", "unpaid-current-balance"],
    notTrustedFor: ["invoices", "payments", "invoice-lines-items"],
    overlap:
      "Full customer list with current balance (including R0.00). Primary current-position authority. Same customers appear in UNPAID ACCOUNTS — post opening once.",
    autoPostTransactions: false,
    columnMappings: [
      { sourceColumn: "Customer", targetField: "accountNumber" },
      { sourceColumn: "Balance", targetField: "openingBalance" },
      { sourceColumn: "Phone", targetField: "parentPhone" },
    ],
  },
  INVOICE_C: {
    kind: "INVOICE_C",
    category: "transactions",
    label: "EXPRESS INVOICE (C)",
    trustedFor: ["payments", "customer-account-identity"],
    notTrustedFor: ["unpaid-current-balance", "invoice-lines-items"],
    overlap:
      "Payment receipts (Date, Customer, Invoice, Method, Reference, Amount). May be identical to EXPRESS INVOICE CC — import each payment once.",
    autoPostTransactions: true,
    columnMappings: [
      { sourceColumn: "Date", targetField: "transactionDate" },
      { sourceColumn: "Customer", targetField: "accountNumber" },
      { sourceColumn: "Invoice", targetField: "reference" },
      { sourceColumn: "Method", targetField: "transactionType" },
      { sourceColumn: "Reference", targetField: "description" },
      { sourceColumn: "Amount", targetField: "amount" },
    ],
  },
  INVOICE_CC: {
    kind: "INVOICE_CC",
    category: "transactions",
    label: "EXPRESS INVOICE CC",
    trustedFor: ["payments", "customer-account-identity"],
    notTrustedFor: ["unpaid-current-balance", "invoice-lines-items"],
    overlap: "Payment receipts. Same shape as EXPRESS INVOICE (C). Deduplicate across both files.",
    autoPostTransactions: true,
    columnMappings: [
      { sourceColumn: "Date", targetField: "transactionDate" },
      { sourceColumn: "Customer", targetField: "accountNumber" },
      { sourceColumn: "Invoice", targetField: "reference" },
      { sourceColumn: "Method", targetField: "transactionType" },
      { sourceColumn: "Reference", targetField: "description" },
      { sourceColumn: "Amount", targetField: "amount" },
    ],
  },
  UNPAID_ACCOUNTS: {
    kind: "UNPAID_ACCOUNTS",
    category: "billing",
    label: "EXPRESS UNPAID ACCOUNTS",
    trustedFor: ["customer-account-identity", "learner-customer-names", "unpaid-current-balance"],
    notTrustedFor: ["invoices", "payments", "invoice-lines-items"],
    overlap:
      "Outstanding balances only. Corroborates EXPRESS INVOICE (B). Do not post a second opening per customer.",
    autoPostTransactions: false,
    columnMappings: [
      { sourceColumn: "Customer", targetField: "accountNumber" },
      { sourceColumn: "Balance", targetField: "openingBalance" },
    ],
  },
  ITEM_SALES: {
    kind: "ITEM_SALES",
    category: "transactions",
    label: "EXPRESS - ITEM SALES REPORT",
    trustedFor: ["invoice-lines-items"],
    notTrustedFor: ["unpaid-current-balance", "payments", "customer-account-identity", "invoices"],
    overlap:
      "Item totals without customer. Supporting only — never auto-posted as family invoices or openings.",
    autoPostTransactions: false,
    columnMappings: [
      { sourceColumn: "Item", targetField: "reference" },
      { sourceColumn: "Description", targetField: "description" },
      { sourceColumn: "Value", targetField: "amount" },
    ],
  },
};

export function expressInvoiceAuthorityForFilename(filename: string): ExpressInvoiceAuthority | null {
  const kind = classifyExpressInvoiceExport(filename);
  if (kind === "NOT_EXPRESS") return null;
  return AUTHORITY[kind];
}

export function expressInvoiceCategoryOverride(filename: string): MigrationFileCategory | null {
  return expressInvoiceAuthorityForFilename(filename)?.category ?? null;
}

export const EXPRESS_INVOICE_PRECEDENCE: Array<{
  role: ExpressInvoiceAuthorityRole;
  authority: ExpressInvoiceExportKind[];
}> = [
  { role: "customer-account-identity", authority: ["INVOICE_B", "UNPAID_ACCOUNTS", "INVOICE_A"] },
  { role: "learner-customer-names", authority: ["INVOICE_B", "UNPAID_ACCOUNTS", "INVOICE_A", "INVOICE_REPORT"] },
  { role: "unpaid-current-balance", authority: ["INVOICE_B", "UNPAID_ACCOUNTS"] },
  { role: "invoices", authority: ["INVOICE_REPORT"] },
  { role: "payments", authority: ["INVOICE_CC", "INVOICE_C"] },
  { role: "invoice-lines-items", authority: ["ITEM_SALES"] },
];

export function shouldAutoPostExpressInvoiceTransactions(filename: string): boolean {
  const authority = expressInvoiceAuthorityForFilename(filename);
  if (!authority) return true;
  return authority.autoPostTransactions;
}
