import { splitMergedAccountNames } from "./daSilvaMergedFamily";
import type { ParsedTransaction } from "./parsers";

/** Notes that indicate closed / removed / refund ledger lines (not active debt). */
const HISTORICAL_MOVEMENT_NOTE =
  /\b(removed|refund|closed|not returning|relocat|write[\s-]?off|learner left|no longer|cancelled|canceled|credit note|discount|not doing|left school|historical|jamf)\b/i;

export type DaSilvaVarianceGroup =
  | "activeAgeAnalysisMismatch"
  | "zeroBalanceHistoricalLedgerOnly"
  | "overpaidCredit"
  | "mergedFamilyLedgerGap";

export type DaSilvaVarianceRowInput = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  variance: number;
};

export function transactionsForAccount(
  accountNo: string,
  transactions: ParsedTransaction[]
): ParsedTransaction[] {
  return transactions.filter((t) => t.accountNo === accountNo);
}

export function isHistoricalLedgerOnlyMovement(
  accountNo: string,
  transactions: ParsedTransaction[],
  inAgeAnalysis: boolean
): boolean {
  const txns = transactionsForAccount(accountNo, transactions);
  if (txns.length === 0) return false;
  if (!inAgeAnalysis) return true;
  return txns.every((t) => {
    const note = String(t.notes || "").trim();
    if (!note) return true;
    return HISTORICAL_MOVEMENT_NOTE.test(note);
  });
}

export function learnersPerAccount(
  learners: { accountNo: string }[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const learner of learners) {
    if (!learner.accountNo) continue;
    counts.set(learner.accountNo, (counts.get(learner.accountNo) || 0) + 1);
  }
  return counts;
}

export function isMergedFamilyAccount(
  accountNo: string,
  fullName: string,
  learnerCountByAccount: Map<string, number>,
  mergedFamilyAccountNos: Set<string>
): boolean {
  if (mergedFamilyAccountNos.has(accountNo)) return true;
  if (splitMergedAccountNames(fullName).length > 1) return true;
  return (learnerCountByAccount.get(accountNo) || 0) > 1;
}

export function classifyVarianceGroup(
  row: DaSilvaVarianceRowInput,
  inAgeAnalysis: boolean,
  transactions: ParsedTransaction[],
  mergedFamily: boolean
): DaSilvaVarianceGroup {
  if (mergedFamily && Math.abs(row.ageAnalysisBalance) > 0.01) {
    return "mergedFamilyLedgerGap";
  }
  if (Math.abs(row.ageAnalysisBalance) > 0.01) {
    return "activeAgeAnalysisMismatch";
  }
  if (row.ledgerBalanceFromImport < -0.01) {
    return "overpaidCredit";
  }
  if (
    row.ledgerBalanceFromImport > 0.01 &&
    isHistoricalLedgerOnlyMovement(row.accountNo, transactions, inAgeAnalysis)
  ) {
    return "zeroBalanceHistoricalLedgerOnly";
  }
  return "activeAgeAnalysisMismatch";
}
