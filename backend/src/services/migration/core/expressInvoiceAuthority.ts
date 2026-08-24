/**
 * Fly Eagle / Express Invoice export authority map.
 * Classification and precedence only — never imports production data.
 */

import type { MigrationFileCategory } from "../types/MigrationFile";

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
    trustedFor: ["invoices", "payments", "customer-account-identity"],
    notTrustedFor: ["unpaid-current-balance", "invoice-lines-items"],
    overlap:
      "May overlap with dated EXPRESS INVOICE (A)/(B)/(C) extracts. Deduplicate by invoice/payment reference.",
  },
  INVOICE_A: {
    kind: "INVOICE_A",
    category: "transactions",
    label: "EXPRESS INVOICE (A)",
    trustedFor: ["invoices", "payments", "overlapping-history-only"],
    notTrustedFor: ["unpaid-current-balance"],
    overlap: "Period extract. Same invoices may appear in REPORT and other lettered files.",
  },
  INVOICE_B: {
    kind: "INVOICE_B",
    category: "transactions",
    label: "EXPRESS INVOICE (B)",
    trustedFor: ["invoices", "payments", "overlapping-history-only"],
    notTrustedFor: ["unpaid-current-balance"],
    overlap: "Period extract. Same invoices may appear in REPORT and other lettered files.",
  },
  INVOICE_C: {
    kind: "INVOICE_C",
    category: "transactions",
    label: "EXPRESS INVOICE (C)",
    trustedFor: ["invoices", "payments", "overlapping-history-only"],
    notTrustedFor: ["unpaid-current-balance"],
    overlap: "Period extract. Same invoices may appear in REPORT and other lettered files.",
  },
  INVOICE_CC: {
    kind: "INVOICE_CC",
    category: "transactions",
    label: "EXPRESS INVOICE CC",
    trustedFor: ["customer-account-identity", "learner-customer-names", "invoices", "payments"],
    notTrustedFor: ["unpaid-current-balance"],
    overlap: "Customer-centric history. May repeat invoices from REPORT and lettered extracts.",
  },
  UNPAID_ACCOUNTS: {
    kind: "UNPAID_ACCOUNTS",
    category: "billing",
    label: "EXPRESS UNPAID ACCOUNTS",
    trustedFor: ["customer-account-identity", "learner-customer-names", "unpaid-current-balance"],
    notTrustedFor: ["invoices", "payments", "invoice-lines-items"],
    overlap:
      "Authority for current/unpaid balance and account identity. Do not also post the same figures as invoices.",
  },
  ITEM_SALES: {
    kind: "ITEM_SALES",
    category: "transactions",
    label: "EXPRESS - ITEM SALES REPORT",
    trustedFor: ["invoice-lines-items"],
    notTrustedFor: ["unpaid-current-balance", "payments", "customer-account-identity"],
    overlap:
      "Line-item detail for invoices already in invoice reports. Do not treat each line as a separate opening or invoice total.",
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
  { role: "customer-account-identity", authority: ["UNPAID_ACCOUNTS", "INVOICE_CC", "INVOICE_REPORT"] },
  { role: "learner-customer-names", authority: ["UNPAID_ACCOUNTS", "INVOICE_CC"] },
  { role: "unpaid-current-balance", authority: ["UNPAID_ACCOUNTS"] },
  { role: "invoices", authority: ["INVOICE_REPORT", "INVOICE_CC", "INVOICE_A", "INVOICE_B", "INVOICE_C"] },
  { role: "payments", authority: ["INVOICE_REPORT", "INVOICE_CC", "INVOICE_A", "INVOICE_B", "INVOICE_C"] },
  { role: "invoice-lines-items", authority: ["ITEM_SALES"] },
];
