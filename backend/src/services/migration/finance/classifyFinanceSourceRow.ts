/**
 * Classify mapped migration finance rows into the Phase 1G contract.
 */

import type { MigrationTargetField } from "../types/MigrationTargetField";
import type { FinanceRowClass } from "./FinanceClassification";

type MappedRow = Partial<Record<MigrationTargetField, string>>;

export type ClassifyFinanceRowInput = {
  mapped: MappedRow;
  sourceColumnHints?: string[];
  /** Confirmed by operator for previously ambiguous finance columns. */
  financeConfirmed?: boolean;
  /** When true, pre-cutover transaction rows are history-only (not posted with openings). */
  treatPreCutoverAsHistory?: boolean;
  isPreCutover?: boolean;
};

function haystack(mapped: MappedRow, hints: string[]): string {
  return [
    ...hints,
    mapped.transactionType || "",
    mapped.description || "",
    mapped.reference || "",
  ]
    .join(" ")
    .toLowerCase();
}

export function classifyFinanceSourceRow(input: ClassifyFinanceRowInput): {
  classification: FinanceRowClass;
  reason: string;
} {
  const mapped = input.mapped;
  const hints = input.sourceColumnHints || [];
  const hay = haystack(mapped, hints);

  const hasOpeningTarget = Boolean(String(mapped.openingBalance || "").trim());
  const looksOpening =
    hasOpeningTarget ||
    hints.some((h) => /opening.?balance|brought.?forward|bfwd/i.test(h));

  if (looksOpening) {
    return {
      classification: "OPENING_BALANCE",
      reason: "Opening balance column/target — posts as ledger opening adjustment, never as payment.",
    };
  }

  const hasPlan =
    Boolean(String(mapped.billingPlan || "").trim()) ||
    Boolean(String(mapped.feeAmount || "").trim());
  if (hasPlan && !mapped.transactionDate && !mapped.amount && !mapped.debit && !mapped.credit) {
    return {
      classification: "BILLING_PLAN",
      reason: "Billing plan / fee schedule fields.",
    };
  }

  const hasAccountMeta =
    Boolean(String(mapped.accountNumber || "").trim()) ||
    Boolean(String(mapped.accountName || "").trim());
  const hasMoney =
    Boolean(String(mapped.amount || "").trim()) ||
    Boolean(String(mapped.debit || "").trim()) ||
    Boolean(String(mapped.credit || "").trim()) ||
    Boolean(String(mapped.currentBalance || "").trim());

  if (hasAccountMeta && !hasMoney && !hasPlan && !mapped.transactionDate) {
    return {
      classification: "ACCOUNT_METADATA",
      reason: "Account identity fields only.",
    };
  }

  if (input.treatPreCutoverAsHistory && input.isPreCutover) {
    return {
      classification: "TRANSACTION_HISTORY",
      reason:
        "Pre-cutover history kept for reference — position carried by opening balance, not double-posted.",
    };
  }

  const typeHay = String(mapped.transactionType || "").toLowerCase();
  if (/payment|receipt|paid/i.test(typeHay) || /payment/i.test(hay)) {
    return { classification: "PAYMENT", reason: "Payment / receipt row." };
  }
  if (/invoice|fee|charge|debit/i.test(typeHay)) {
    return { classification: "INVOICE", reason: "Invoice / charge row." };
  }
  if (/credit|refund|cn\b/i.test(typeHay) && !/adjustment|write.?off|discount/i.test(typeHay)) {
    return { classification: "CREDIT", reason: "Credit note / credit row." };
  }
  if (/adjustment|write.?off|discount|journal/i.test(typeHay) || /adjustment|write.?off/i.test(hay)) {
    if (!input.financeConfirmed) {
      return {
        classification: "UNKNOWN_FINANCE",
        reason: "Ambiguous adjustment — requires operator confirmation before posting.",
      };
    }
    return { classification: "ADJUSTMENT", reason: "Confirmed adjustment." };
  }

  if (
    /balance/i.test(hay) &&
    !mapped.transactionDate &&
    !input.financeConfirmed
  ) {
    return {
      classification: "UNKNOWN_FINANCE",
      reason: "Ambiguous balance column — confirm mapping before any posting.",
    };
  }

  if (mapped.transactionDate && hasMoney) {
    return {
      classification: "INVOICE",
      reason: "Dated money movement — treated as invoice unless type says otherwise.",
    };
  }

  if (hasMoney && !input.financeConfirmed) {
    return {
      classification: "UNKNOWN_FINANCE",
      reason: "Money present without clear type — UNKNOWN_FINANCE never auto-posts.",
    };
  }

  return {
    classification: "UNKNOWN_FINANCE",
    reason: "Unable to classify finance row safely.",
  };
}
