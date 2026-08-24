/**
 * Stable transaction provenance for overlapping Express Invoice (and similar) exports.
 *
 * Source identifiers win. Amount+date alone never discards a transaction.
 */

import { normaliseAmount } from "../../../utils/billingLedgerStore";
import type { LedgerDuplicateKey, LedgerPostingType } from "../types/MigrationLedgerPosting";

function clean(value: unknown): string {
  return String(value || "").trim();
}

export function migrationTransactionProvenance(input: {
  accountRef: string;
  date: string;
  reference: string;
  description?: string;
  amount: number;
  postingType: LedgerPostingType;
}): LedgerDuplicateKey | null {
  const accountRef = clean(input.accountRef).toLowerCase();
  const date = clean(input.date);
  const reference = clean(input.reference).toLowerCase();
  const description = clean(input.description).toLowerCase();
  const amount = normaliseAmount(input.amount);
  if (!accountRef) return null;

  if (reference) {
    return {
      accountRef,
      date: "*",
      reference,
      amount,
      postingType: input.postingType,
    };
  }

  if (!date) return null;

  if (description) {
    return {
      accountRef,
      date,
      reference: `desc:${description}`,
      amount,
      postingType: input.postingType,
    };
  }

  // No source identifier and no description — do not treat as a duplicate.
  return null;
}

export function formatMigrationProvenanceMessage(key: LedgerDuplicateKey | null): string {
  if (!key) return "Transaction has no source identifier — not treated as a duplicate";
  if (key.reference.startsWith("desc:")) {
    return "Duplicate transaction skipped (same account, date, amount, type, and description)";
  }
  return "Duplicate transaction skipped (same source document / invoice or payment reference)";
}
