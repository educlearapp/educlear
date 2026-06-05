import { getLearnerAccountNo } from "../learner/learnerIdentity";
import {
  normalizeKidESysAccountRef,
  resolveKidESysAccountRefFromLearner,
} from "./billingAccountRef";
import { readStatementApiAccounts } from "./kidesysTransactionHistory";

/** Cached GET /api/statements account refs — official billing list when non-empty. */
export function readOfficialBillingAccountRefsFromCache(schoolId: string): Set<string> {
  const refs = new Set<string>();
  for (const row of readStatementApiAccounts(schoolId)) {
    const ref = normalizeKidESysAccountRef((row as { accountNo?: unknown })?.accountNo);
    if (ref) refs.add(ref);
  }
  return refs;
}

/**
 * Invoice-run guard: post only to account refs on the official billing list.
 * Prefers family account ref over orphan admission-derived refs.
 */
export function resolveInvoiceRunAccountRef(row: any, schoolId: string): string {
  const sid = String(schoolId || "").trim();
  const official = readOfficialBillingAccountRefsFromCache(sid);

  const familyRef = resolveKidESysAccountRefFromLearner(row);
  const fromRow = normalizeKidESysAccountRef(row?.accountNo);
  const fromLearner = normalizeKidESysAccountRef(getLearnerAccountNo(row));

  const candidates = [familyRef, fromRow, fromLearner].filter(Boolean);

  if (!official.size) {
    return familyRef || fromRow || fromLearner || "";
  }

  for (const ref of candidates) {
    if (official.has(ref)) return ref;
  }

  return "";
}
