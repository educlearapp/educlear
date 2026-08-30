import {
  normalizeKidESysAccountRef,
  normalizeStatementAccountRef,
  resolveKidESysAccountRefFromLearner,
  resolveStatementAccountRefFromLearner,
} from "./billingAccountRef";
import type { PaymentAccountContext } from "./paymentCreateShared";

/** True when learner's official family account ref matches the selected billing account. */
export function learnerMatchesBillingAccountRef(learner: any, accountRef: string): boolean {
  const familyId = String(learner?.familyAccountId || learner?.familyAccount?.id || "").trim();
  const acctFamily = String(
    (typeof accountRef === "object" && accountRef
      ? (accountRef as { familyAccountId?: string }).familyAccountId
      : "") || ""
  ).trim();
  if (familyId && acctFamily && familyId === acctFamily) return true;
  const acct =
    normalizeKidESysAccountRef(accountRef) || normalizeStatementAccountRef(accountRef);
  if (!acct) return true;
  const learnerRef =
    resolveKidESysAccountRefFromLearner(learner) || resolveStatementAccountRefFromLearner(learner);
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
    const familyId = String(selectedAccount?.familyAccountId || "").trim();
    const matchFamily = String(match?.familyAccountId || match?.familyAccount?.id || "").trim();
    if (match && familyId && matchFamily === familyId) {
      return String(match.id || match.learnerId || "").trim();
    }
    if (match && learnerMatchesBillingAccountRef(match, acct)) {
      return String(match.id || match.learnerId || "").trim();
    }
  }

  const familyId = String(selectedAccount?.familyAccountId || "").trim();
  if (familyId) {
    const byFamily = list.find(
      (l) => String(l?.familyAccountId || l?.familyAccount?.id || "").trim() === familyId
    );
    if (byFamily) return String(byFamily.id || byFamily.learnerId || "").trim();
  }

  const kidRef = normalizeKidESysAccountRef(acct);
  if (kidRef) {
    const byAccount = list.find((l) => resolveKidESysAccountRefFromLearner(l) === kidRef);
    if (byAccount) return String(byAccount.id || byAccount.learnerId || "").trim();
  }
  const statementRef = normalizeStatementAccountRef(acct);
  if (statementRef) {
    const byAccount = list.find(
      (l) => resolveStatementAccountRefFromLearner(l) === statementRef
    );
    if (byAccount) return String(byAccount.id || byAccount.learnerId || "").trim();
  }

  return "";
}

/**
 * Learner id for manual invoice POST — only when exactly one learner belongs to accountNo.
 * Family/ambiguous accounts post accountNo only (empty learnerId).
 */
export function resolveManualInvoiceLearnerId(
  selectedAccount: PaymentAccountContext | null,
  learners: any[],
  accountNo: string
): string {
  const acct = normalizeKidESysAccountRef(accountNo);
  if (!acct) return "";

  const list = Array.isArray(learners) ? learners : [];
  const onAccount = list.filter((l) => resolveKidESysAccountRefFromLearner(l) === acct);
  if (onAccount.length !== 1) return "";

  const learner = onAccount[0];
  const learnerId = String(learner?.id || learner?.learnerId || "").trim();
  if (!learnerId || !learnerMatchesBillingAccountRef(learner, acct)) return "";

  const resolvedFromSelection = resolvePaymentLearnerId(selectedAccount, learners, acct);
  if (resolvedFromSelection && resolvedFromSelection !== learnerId) return "";

  return learnerId;
}
