import { DA_SILVA_ACADEMY_SCHOOL_ID } from "./activateDaSilvaSubscription";
import {
  isKidesysBlockedBillingSource,
  isKidesysHistoryIdOrReference,
  isNonPostingImportedLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  readSchoolLedger,
  removeSchoolEntry,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { clearPaymentAllocations } from "../utils/paymentAllocationStore";

const STUCK_ACCOUNT = "ALI002";
const STUCK_DATE = "2026-06-01";
const STUCK_REFERENCE = "EFT";
const MAX_REMOVE = 3;

/** Manual EFT test payments on ALI002 (2026-06-01) — not Kid-e-Sys imported ledger rows. */
export function isStuckAli002ManualTestPayment(entry: BillingLedgerEntry): boolean {
  if (String(entry.accountNo || "").trim().toUpperCase() !== STUCK_ACCOUNT) return false;
  if (entry.type !== "payment") return false;
  if (String(entry.date || "").slice(0, 10) !== STUCK_DATE) return false;
  if (String(entry.reference || "").trim().toUpperCase() !== STUCK_REFERENCE) return false;
  if (isKidesysBlockedBillingSource(entry.source)) return false;
  if (isKidesysHistoryIdOrReference(entry.id, entry.reference)) return false;
  if (isNonPostingImportedLedgerEntry(entry)) return false;
  return true;
}

/** Idempotent: remove up to three stuck manual test payments (newest first). */
export function removeStuckAli002ManualTestPayments(
  schoolId: string = DA_SILVA_ACADEMY_SCHOOL_ID
): string[] {
  const ledger = readSchoolLedger(schoolId);
  const candidates = ledger
    .filter(isStuckAli002ManualTestPayment)
    .sort(
      (a, b) =>
        new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime()
    )
    .slice(0, MAX_REMOVE);

  const removed: string[] = [];
  for (const entry of candidates) {
    const deleted = removeSchoolEntry(schoolId, entry.id);
    if (!deleted) continue;
    if (deleted.type === "payment") {
      clearPaymentAllocations(schoolId, deleted.id);
    }
    removed.push(deleted.id);
  }
  return removed;
}
