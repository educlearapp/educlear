import type { CreditorInvoice } from "./accountingCreditorsHelpers";
import {
  loadCreditorInvoicesFromEngine,
  migrateLegacyCreditorInvoices,
} from "./supplierInvoiceHelpers";

/** Single source for Creditors Ageing — supplier invoice engine with legacy migration. */
export function loadCreditorInvoicesUnified(schoolId: string): CreditorInvoice[] {
  migrateLegacyCreditorInvoices(schoolId);
  return loadCreditorInvoicesFromEngine(schoolId);
}
