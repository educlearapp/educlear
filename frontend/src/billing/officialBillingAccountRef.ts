import { getLearnerAccountNo } from "../learner/learnerIdentity";
import {
  normalizeKidESysAccountRef,
  normalizeStatementAccountRef,
  resolveKidESysAccountRefFromLearner,
} from "./billingAccountRef";
import { readStatementApiAccounts } from "./kidesysTransactionHistory";

/** Cached GET /api/statements Kid-e-Sys account refs — official list when non-empty. */
export function readOfficialBillingAccountRefsFromCache(schoolId: string): Set<string> {
  const refs = new Set<string>();
  for (const row of readStatementApiAccounts(schoolId)) {
    const ref = normalizeKidESysAccountRef((row as { accountNo?: unknown })?.accountNo);
    if (ref) refs.add(ref);
  }
  return refs;
}

/**
 * Invoice-run posting guard.
 * When the school has Kid-e-Sys official refs (Da Silva), keep that list.
 * When the official Kid-e-Sys set is empty, post to the learner-linked
 * statement-safe family ref (Express names). Never SA-SAMS numeric admission
 * numbers, and never every statement account merely because it exists.
 */
export function resolveInvoiceRunAccountRef(row: any, schoolId: string): string {
  const sid = String(schoolId || "").trim();
  const official = readOfficialBillingAccountRefsFromCache(sid);

  const familyKid = resolveKidESysAccountRefFromLearner(row);
  const fromRowKid = normalizeKidESysAccountRef(row?.accountNo);
  const fromLearnerKid = normalizeKidESysAccountRef(getLearnerAccountNo(row));

  if (official.size > 0) {
    const candidates = [familyKid, fromRowKid, fromLearnerKid].filter(Boolean);
    for (const ref of candidates) {
      if (official.has(ref)) return ref;
    }
    return "";
  }

  const familyStmt = normalizeStatementAccountRef(row?.familyAccount?.accountRef);
  const fromRowStmt = normalizeStatementAccountRef(row?.accountNo);
  const fromLearnerStmt = normalizeStatementAccountRef(getLearnerAccountNo(row));
  return familyStmt || fromRowStmt || fromLearnerStmt || "";
}
