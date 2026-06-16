export type InvoiceBatchSaveResult = {
  success?: boolean;
  createdCount?: number;
  duplicateCount?: number;
  skipped?: Array<{ index?: number; reason?: string; accountNo?: string; learnerId?: string }>;
  invoices?: unknown[];
  error?: string;
  errorCode?: string;
};

/** Validate invoice batch response — throws with user-facing message when nothing saved. */
export function assertInvoiceBatchSaveSucceeded(
  result: InvoiceBatchSaveResult | null | undefined
): void {
  if (!result || result.success === false) {
    throw new Error(String(result?.error || "Invoice was not saved on the server."));
  }
  const createdCount = Number(
    result.createdCount ??
      (Array.isArray(result.invoices) ? result.invoices.length : 0)
  );
  if (createdCount > 0) return;

  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const reasons = skipped
    .map((row) => String(row?.reason || "").trim())
    .filter(Boolean);
  const detail = reasons.length ? reasons.join("; ") : "No invoice lines were saved.";
  throw new Error(detail);
}
