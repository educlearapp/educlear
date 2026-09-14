/**
 * Banking field policy: CORE fee matching vs optional ACCOUNTING expense/supplier metadata.
 * Phase 5B: Banking available when CORE || ACCOUNTING; each mode exposes different fields.
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

/** Learner / fee-account fields stripped from Accounting-only banking responses. */
export const CORE_BANKING_READ_FIELDS = [
  "suggestedAccountId",
  "suggestedAccountNo",
  "suggestedLearnerId",
  "suggestedLearnerName",
  "confidenceScore",
  "matchConfidence",
  "matchReason",
  "postedPaymentId",
  "suggestedInvoiceId",
  "suggestedInvoiceNumber",
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

/** Fee-match / FamilyAccount mutation signals — CORE only. */
const CORE_FEE_MUTATION_KEYS = new Set<string>([
  "suggestedAccountId",
  "suggestedAccountNo",
  "suggestedLearnerId",
  "suggestedLearnerName",
  "matchAction",
  "postedPaymentId",
  "transactionIds",
]);

export type BankingModuleFlags = {
  coreEnabled: boolean;
  accountingEnabled: boolean;
};

export type AccountingBankingViolation = {
  fields: string[];
  code: typeof MODULE_NOT_ENTITLED;
  module: "ACCOUNTING";
  error: string;
};

export type CoreBankingViolation = {
  fields: string[];
  code: typeof MODULE_NOT_ENTITLED;
  module: "CORE";
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

export function findCoreBankingMutationFields(
  body: Record<string, unknown> | null | undefined
): string[] {
  if (!body || typeof body !== "object") return [];
  const found = new Set<string>();
  for (const key of Object.keys(body)) {
    if (CORE_FEE_MUTATION_KEYS.has(key)) {
      const value = body[key];
      if (value === undefined || value === null || value === "") continue;
      if (key === "matchAction") {
        const action = String(value).trim().toLowerCase();
        if (action === "accept" || action === "reject") found.add(key);
        continue;
      }
      found.add(key);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "transactionType")) {
    const tt = String(body.transactionType || "").trim().toLowerCase();
    if (tt === "payment") found.add("transactionType");
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

export function assertNoCoreBankingMutationWhenDisabled(
  body: Record<string, unknown>,
  coreEnabled: boolean
): CoreBankingViolation | null {
  if (coreEnabled) return null;
  const fields = findCoreBankingMutationFields(body);
  if (!fields.length) return null;
  return {
    fields,
    code: MODULE_NOT_ENTITLED,
    module: "CORE",
    error:
      "Fee-payment banking fields cannot be set while the CORE module is disabled for this school",
  };
}

export function sanitizeBankTransactionForModule<T extends Record<string, unknown>>(
  row: T,
  accountingEnabled: boolean,
  coreEnabled = true
): T {
  const out: Record<string, unknown> = { ...row };

  if (!accountingEnabled) {
    for (const key of ACCOUNTING_BANKING_READ_FIELDS) {
      if (key in out) {
        if (key === "invoiceMatchScore") out[key] = 0;
        else out[key] = "";
      }
    }
    if (String(out.transactionType || "").toLowerCase() === "expense") {
      out.transactionType = out.direction === "out" ? "ignore" : coreEnabled ? "payment" : "ignore";
    }
  }

  if (!coreEnabled) {
    for (const key of CORE_BANKING_READ_FIELDS) {
      if (key in out) {
        if (key === "confidenceScore") out[key] = 0;
        else out[key] = "";
      }
    }
    if (String(out.transactionType || "").toLowerCase() === "payment") {
      out.transactionType = "ignore";
    }
  }

  return out as T;
}

export function sanitizeBankTransactionsForModule<T extends Record<string, unknown>>(
  rows: T[],
  accountingEnabled: boolean,
  coreEnabled = true
): T[] {
  return rows.map((row) => sanitizeBankTransactionForModule(row, accountingEnabled, coreEnabled));
}

export function sanitizeBankingStatsForModule<T extends Record<string, unknown>>(
  stats: T,
  accountingEnabled: boolean,
  coreEnabled = true
): T {
  const out: Record<string, unknown> = { ...stats };
  if (!accountingEnabled && "expenseCandidates" in out) out.expenseCandidates = 0;
  if (!coreEnabled) {
    if ("paymentCandidates" in out) out.paymentCandidates = 0;
    if ("matchedLearners" in out) out.matchedLearners = 0;
  }
  return out as T;
}

export async function resolveAccountingModuleEnabled(schoolId: string): Promise<boolean> {
  return isSchoolModuleEnabled(schoolId, "ACCOUNTING");
}

export async function resolveCoreModuleEnabled(schoolId: string): Promise<boolean> {
  return isSchoolModuleEnabled(schoolId, "CORE");
}

export async function resolveBankingModuleFlags(schoolId: string): Promise<BankingModuleFlags> {
  const [coreEnabled, accountingEnabled] = await Promise.all([
    isSchoolModuleEnabled(schoolId, "CORE"),
    isSchoolModuleEnabled(schoolId, "ACCOUNTING"),
  ]);
  return { coreEnabled, accountingEnabled };
}

/**
 * Import create-row transactionType.
 * Legacy: second arg boolean = accountingEnabled (CORE assumed on).
 * Preferred: { coreEnabled, accountingEnabled }.
 */
export function bankImportTransactionTypeForModule(
  direction: "in" | "out",
  accountingEnabledOrOpts: boolean | BankingModuleFlags
): "payment" | "expense" | "ignore" {
  const opts: BankingModuleFlags =
    typeof accountingEnabledOrOpts === "boolean"
      ? { coreEnabled: true, accountingEnabled: accountingEnabledOrOpts }
      : accountingEnabledOrOpts;

  if (direction === "in") {
    return opts.coreEnabled ? "payment" : "ignore";
  }
  return opts.accountingEnabled ? "expense" : "ignore";
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

/** When CORE is off, never persist learner/fee-account suggestions. */
export function persistableBankImportCoreFields(
  coreEnabled: boolean,
  inferred: {
    suggestedAccountId: string;
    suggestedAccountNo: string;
    suggestedLearnerId: string;
    suggestedLearnerName: string;
    confidenceScore: number;
    matchConfidence: string;
    matchReason: string;
  }
) {
  if (coreEnabled) return inferred;
  return {
    suggestedAccountId: "",
    suggestedAccountNo: "",
    suggestedLearnerId: "",
    suggestedLearnerName: "",
    confidenceScore: 0,
    matchConfidence: "none",
    matchReason: "",
  };
}
