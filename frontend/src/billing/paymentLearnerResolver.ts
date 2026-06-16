import {
  normalizeKidESysAccountRef,
  resolveKidESysAccountRefFromLearner,
} from "./billingAccountRef";
import type { PaymentAccountContext } from "./paymentCreateShared";

/** True when learner's official family account ref matches the selected billing account. */
export function learnerMatchesBillingAccountRef(learner: any, accountRef: string): boolean {
  const acct = normalizeKidESysAccountRef(accountRef);
  if (!acct) return true;
  const learnerRef = resolveKidESysAccountRefFromLearner(learner);
  return Boolean(learnerRef && learnerRef === acct);
}

/**
 * Real learner UUID for ledger rows — never use selectedAccount.id when it is only an account ref.
 * Candidate learnerId is only accepted when that learner belongs to accountNo; otherwise we
 * resolve from accountNo so stale account switches cannot carry a previous learner into payloads.
 */
export function resolvePaymentLearnerId(
  selectedAccount: PaymentAccountContext | null,
  learners: any[],
  accountNo: string
): string {
  const acct = String(accountNo || selectedAccount?.accountNo || "").trim();
  const candidate = String(selectedAccount?.learnerId || "").trim();
  const list = Array.isArray(learners) ? learners : [];

  if (candidate) {
    const match = list.find(
      (l) => String(l?.id || l?.learnerId || "").trim() === candidate
    );
    if (match && learnerMatchesBillingAccountRef(match, acct)) {
      return String(match.id || match.learnerId || "").trim();
    }
  }

  const kidRef = normalizeKidESysAccountRef(acct);
  if (kidRef) {
    const byAccount = list.find((l) => resolveKidESysAccountRefFromLearner(l) === kidRef);
    if (byAccount) return String(byAccount.id || byAccount.learnerId || "").trim();
  }

  return "";
}
