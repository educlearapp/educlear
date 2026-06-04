import { relinkSchoolBillingLedger } from "./billingLedgerRelink";
import { readSchoolLedger, type BillingLedgerEntry } from "../utils/billingLedgerStore";

/**
 * Shared ledger finalize step after payment writes (manual Create Payment, top-up import, rollback).
 * Re-links accountNo → learnerId, then returns the authoritative ledger slice for balance rebuild.
 */
export async function finalizeSchoolBillingLedgerAfterPaymentWrites(
  schoolId: string
): Promise<BillingLedgerEntry[]> {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];
  await relinkSchoolBillingLedger(sid);
  return readSchoolLedger(sid);
}
