/**
 * Phase 1G — explicit finance row classification contract.
 * UNKNOWN_FINANCE must never be posted automatically.
 */

export type FinanceRowClass =
  | "OPENING_BALANCE"
  | "PAYMENT"
  | "INVOICE"
  | "CREDIT"
  | "ADJUSTMENT"
  | "BILLING_PLAN"
  | "TRANSACTION_HISTORY"
  | "ACCOUNT_METADATA"
  | "UNKNOWN_FINANCE";

export const FINANCE_ROW_CLASSES: readonly FinanceRowClass[] = [
  "OPENING_BALANCE",
  "PAYMENT",
  "INVOICE",
  "CREDIT",
  "ADJUSTMENT",
  "BILLING_PLAN",
  "TRANSACTION_HISTORY",
  "ACCOUNT_METADATA",
  "UNKNOWN_FINANCE",
] as const;

export const UMIG_OPENING_BALANCE_SOURCE = "universal_migration_opening_balance";
export const UMIG_OPENING_BALANCE_LABEL = "Migration opening balance";
export const UMIG_OPENING_REFERENCE_PREFIX = "UMIG-OPENING-";

export function canAutoPostFinanceClass(cls: FinanceRowClass): boolean {
  switch (cls) {
    case "OPENING_BALANCE":
    case "PAYMENT":
    case "INVOICE":
    case "CREDIT":
    case "BILLING_PLAN":
    case "ACCOUNT_METADATA":
      return true;
    case "ADJUSTMENT":
    case "TRANSACTION_HISTORY":
    case "UNKNOWN_FINANCE":
      return false;
    default:
      return false;
  }
}
