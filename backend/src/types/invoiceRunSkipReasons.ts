export const INVOICE_RUN_SKIP_REASONS = [
  "BILLING_PLAN_EMPTY",
  "ZERO_INVOICE_AMOUNT",
  "OFFICIAL_ACCOUNT_REF_NOT_RESOLVED",
  "DUPLICATE_INVOICE",
  "INACTIVE_LEARNER",
  "ACCOUNT_NOT_FOUND",
  "SIBLING_VALIDATION_FAILED",
] as const;

export type InvoiceRunSkipReason = (typeof INVOICE_RUN_SKIP_REASONS)[number];

export function isInvoiceRunSkipReason(value: string): value is InvoiceRunSkipReason {
  return (INVOICE_RUN_SKIP_REASONS as readonly string[]).includes(value);
}
