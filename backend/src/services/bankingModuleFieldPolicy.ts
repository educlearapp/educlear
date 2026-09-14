/**
 * Banking field policy: CORE fee matching vs optional ACCOUNTING expense/supplier metadata.
 */
import { MODULE_NOT_ENTITLED } from "../middleware/requireSchoolModule";
import { isSchoolModuleEnabled } from "./schoolModuleEntitlements";

/** Fee-payment matching / posting — CORE Billing. */
export const CORE_BANKING_MUTATION_FIELDS = [
  "schoolId",
  "matchAction",
  "reviewStatus",
  "suggestedAccountId",
  "suggestedAccountNo",
  "suggestedLearnerId",
  "suggestedLearnerName",
  "confidenceScore",
  "matchConfidence",
  "matchReason",
  "description",
  "transactionIds",
] as const;

/**
 * Expense / supplier / invoice accounting classification — ACCOUNTING only.
 * transactionType=expense is also ACCOUNTING (fee lines use payment/ignore/transfer).
 */
export const ACCOUNTING_BANKING_MUTATION_FIELDS = [
  "expenseCategory",
  "suggestedSupplierName",
  "supplierId",
  "suggestedInvoiceId",
  "suggestedInvoiceNumber",
  "invoiceMatchScore",
  "expenseNotes",
] as const;

export const ACCOUNTING_BANKING_READ_FIELDS = [
  "expenseCategory",
  "suggestedSupplierName",
  "supplierId",
  "expenseNotes",
  "suggestedInvoiceId",
  "suggestedInvoiceNumber",
  "invoiceMatchScore",
] as const;

const ACCOUNTING_MUTATION_SET = new Set<string>(ACCOUNTING_BANKING_MUTATION_FIELDS);

export type AccountingBankingViolation = {
  fields: string[];
  code: typeof MODULE_NOT_ENTITLED;
  module: "ACCOUNTING";
  error: string;
};

export function findAccountingBankingMutationFields(
  body: Record<string, unknown> | null | undefined
): string[] {
  if (!body || typeof body !== "object") return [];
  const found = new Set<string>();
  for (const key of Object.keys(body)) {
    if (ACCOUNTING_MUTATION_SET.has(key)) found.add(key);
  }
  if (Object.prototype.hasOwnProperty.call(body, "transactionType")) {
    const tt = String(body.transactionType || "").trim().toLowerCase();
    if (tt === "expense") found.add("transactionType");
  }
  return [...found].sort();
}

export function assertNoAccountingBankingMutationWhenDisabled(
  body: Record<string, unknown>,
  accountingEnabled: boolean
): AccountingBankingViolation | null {
  if (accountingEnabled) return null;
  const fields = findAccountingBankingMutationFields(body);
  if (!fields.length) return null;
  return {
    fields,
    code: MODULE_NOT_ENTITLED,
    module: "ACCOUNTING",
    error:
      "Accounting-only banking fields cannot be set while the ACCOUNTING module is disabled for this school",
  };
}

export function sanitizeBankTransactionForModule<T extends Record<string, unknown>>(
  row: T,
  accountingEnabled: boolean
): T {
  if (accountingEnabled) return row;
  const out: Record<string, unknown> = { ...row };
  for (const key of ACCOUNTING_BANKING_READ_FIELDS) {
    if (key in out) {
      if (key === "invoiceMatchScore") out[key] = 0;
      else out[key] = "";
    }
  }
  // Hide expense classification type from Core responses; keep payment/ignore/transfer.
  if (String(out.transactionType || "").toLowerCase() === "expense") {
    out.transactionType = out.direction === "out" ? "ignore" : "payment";
  }
  return out as T;
}

export function sanitizeBankTransactionsForModule<T extends Record<string, unknown>>(
  rows: T[],
  accountingEnabled: boolean
): T[] {
  return rows.map((row) => sanitizeBankTransactionForModule(row, accountingEnabled));
}

export function sanitizeBankingStatsForModule<T extends Record<string, unknown>>(
  stats: T,
  accountingEnabled: boolean
): T {
  if (accountingEnabled) return stats;
  const out: Record<string, unknown> = { ...stats };
  if ("expenseCandidates" in out) out.expenseCandidates = 0;
  return out as T;
}

export async function resolveAccountingModuleEnabled(schoolId: string): Promise<boolean> {
  return isSchoolModuleEnabled(schoolId, "ACCOUNTING");
}

/**
 * Import create-row transactionType: fee inflows stay payment;
 * outflows are expense only when ACCOUNTING is on (else ignore — not Accounting classification).
 */
export function bankImportTransactionTypeForModule(
  direction: "in" | "out",
  accountingEnabled: boolean
): "payment" | "expense" | "ignore" {
  if (direction === "in") return "payment";
  return accountingEnabled ? "expense" : "ignore";
}

export type BankImportAccountingEnrichment = {
  expenseCategory: string;
  suggestedSupplierName: string;
  supplierId: string;
  suggestedInvoiceId: string;
  suggestedInvoiceNumber: string;
  invoiceMatchScore: number;
  expenseNotes: string;
  expenseMatchReason: string;
};

/**
 * When ACCOUNTING is off, never persist inferred expense/supplier/invoice enrichment.
 * Historical rows are not rewritten by this helper (import create path only).
 */
export function persistableBankImportAccountingFields(
  accountingEnabled: boolean,
  inferred: BankImportAccountingEnrichment
): BankImportAccountingEnrichment {
  if (accountingEnabled) return inferred;
  return {
    expenseCategory: "",
    suggestedSupplierName: "",
    supplierId: "",
    suggestedInvoiceId: "",
    suggestedInvoiceNumber: "",
    invoiceMatchScore: 0,
    expenseNotes: "",
    expenseMatchReason: "",
  };
}
