/**
 * Bank Reconciliation Review — display/filter helpers only.
 * Does not change matching, posting, confidence thresholds, or ledger logic.
 */
import type { BankTransactionRow } from "./bankingApi";
import {
  canPostBankPaymentToBilling,
  isUnmatchedTxn,
  suggestedMatchLabel,
  txnType,
  type BankingTransactionType,
} from "./bankingReconciliationUtils";

export type QueueFilter =
  | "all"
  | "matched"
  | "suggested"
  | "unmatched"
  | "duplicate"
  | "accepted"
  | "rejected";

export type ConfidenceFilter = "all" | "high" | "medium" | "low" | "none";

export type TypeFilter = "all" | BankingTransactionType;

export type ReviewQueueCounts = Record<QueueFilter, number>;

export type ReviewKpiItem = {
  key: string;
  label: string;
  value: number;
  money?: boolean;
};

export type DisplayStatusKind =
  | "matched"
  | "suggested"
  | "unmatched"
  | "duplicate"
  | "ready"
  | "card_settlement"
  | "posted"
  | "accepted"
  | "ignored"
  | "rejected"
  | "other";

export type DisplayStatus = {
  kind: DisplayStatusKind;
  label: string;
  helper: string;
};

export const REVIEW_PAGE_SIZE = 12;

export const QUEUE_FILTER_CHIPS: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "matched", label: "Matched" },
  { id: "suggested", label: "Suggested" },
  { id: "unmatched", label: "Unmatched" },
  { id: "duplicate", label: "Duplicates" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
];

/** Frontend-only Speedpoint / card-machine settlement detection from bank text. */
export function looksLikeCardSettlement(
  txn: Pick<BankTransactionRow, "description" | "reference">
): boolean {
  const blob = `${txn.description || ""} ${txn.reference || ""}`;
  return /speedpoint/i.test(blob);
}

export function compactMatchReason(reason: string): string {
  const r = String(reason || "").trim();
  if (!r) return "";
  const lower = r.toLowerCase();
  if (lower.includes("full name") || lower.includes("surname") || lower.includes("name matched")) {
    return "Name match";
  }
  if (lower.includes("account number")) return "Account match";
  if (lower.includes("invoice")) return "Invoice match";
  if (lower.includes("previous accepted")) return "Previous match";
  if (lower.includes("manually")) return "Manual";
  if (lower.includes("supplier")) return "Supplier match";
  return r;
}

export function matchColumnView(txn: BankTransactionRow): { primary: string; secondary: string } {
  const card = looksLikeCardSettlement(txn);
  const helper = "Speedpoint settlement — reconcile separately";
  const hasLearner =
    !!txn.suggestedLearnerId ||
    (!!txn.suggestedAccountNo && txn.suggestedAccountNo !== "-");

  if (card && !hasLearner) {
    return { primary: "Card settlement", secondary: helper };
  }

  const primary = suggestedMatchLabel(txn);
  const reason = compactMatchReason(txn.matchReason);
  if (card) {
    return { primary, secondary: reason ? `${reason} · ${helper}` : helper };
  }
  return { primary, secondary: reason };
}

export function formatCompactConfidence(txn: BankTransactionRow): string {
  if (txn.direction !== "in") return txn.expenseCategory ? "rule" : "—";
  if (txn.confidenceScore > 0) return `${txn.confidenceScore}%`;
  if (txn.matchConfidence && txn.matchConfidence !== "none") return txn.matchConfidence;
  return "—";
}

export function compactConfidenceTone(
  txn: BankTransactionRow
): "high" | "medium" | "low" | "none" {
  if (txn.matchConfidence === "high" || txn.matchConfidence === "medium" || txn.matchConfidence === "low") {
    return txn.matchConfidence;
  }
  return "none";
}

export function compactDate(date: string): string {
  const raw = String(date || "").trim();
  if (!raw) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

export function displayStatus(txn: BankTransactionRow): DisplayStatus {
  if (txn.isDuplicate || txn.matchStatus === "duplicate") {
    return { kind: "duplicate", label: "Duplicate", helper: "Duplicate bank line" };
  }
  if (txn.reviewStatus === "posted") {
    return { kind: "posted", label: "Posted", helper: txn.postedPaymentId ? `Billing ${txn.postedPaymentId}` : "" };
  }
  if (looksLikeCardSettlement(txn) && txn.reviewStatus !== "accepted") {
    return {
      kind: "card_settlement",
      label: "Card Settlement",
      helper: "Speedpoint settlement — reconcile separately",
    };
  }
  if (canPostBankPaymentToBilling(txn) || txn.matchStatus === "ready_to_post") {
    return { kind: "ready", label: "Ready", helper: "Accepted and ready to post" };
  }
  if (txn.reviewStatus === "accepted" || txn.matchStatus === "accepted") {
    return { kind: "accepted", label: "Ready", helper: "Accepted" };
  }
  if (txn.reviewStatus === "ignored") {
    return { kind: "ignored", label: "Ignored", helper: "" };
  }
  if (txn.matchStatus === "matched") {
    return { kind: "matched", label: "Matched", helper: compactMatchReason(txn.matchReason) };
  }
  if (txn.matchStatus === "suggested") {
    return { kind: "suggested", label: "Suggested", helper: compactMatchReason(txn.matchReason) };
  }
  if (txn.matchStatus === "rejected" || txn.reviewStatus === "unmatched") {
    return { kind: "rejected", label: "Unmatched", helper: "Match rejected" };
  }
  if (isUnmatchedTxn(txn) || txn.matchStatus === "unmatched") {
    return { kind: "unmatched", label: "Unmatched", helper: "" };
  }
  return { kind: "other", label: String(txn.matchStatus || txn.reviewStatus || "Imported"), helper: "" };
}

/**
 * Card settlements must not be accepted onto a learner account from this UI pass.
 * Posting eligibility itself remains canPostBankPaymentToBilling (unchanged).
 */
export function allowLearnerAcceptAction(txn: BankTransactionRow): boolean {
  if (looksLikeCardSettlement(txn)) return false;
  if (txn.reviewStatus === "posted") return false;
  return true;
}

export function matchesQueueFilter(txn: BankTransactionRow, filter: QueueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "duplicate") return Boolean(txn.isDuplicate) || txn.matchStatus === "duplicate";
  if (filter === "accepted") {
    return txn.reviewStatus === "accepted" || txn.matchStatus === "accepted";
  }
  if (filter === "rejected") {
    return txn.reviewStatus === "unmatched" || txn.matchStatus === "rejected";
  }
  if (filter === "matched") return txn.matchStatus === "matched";
  if (filter === "suggested") return txn.matchStatus === "suggested";
  if (filter === "unmatched") return isUnmatchedTxn(txn);
  return true;
}

export function countQueueFilters(txns: BankTransactionRow[]): ReviewQueueCounts {
  const counts: ReviewQueueCounts = {
    all: txns.length,
    matched: 0,
    suggested: 0,
    unmatched: 0,
    duplicate: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const txn of txns) {
    if (matchesQueueFilter(txn, "matched")) counts.matched += 1;
    if (matchesQueueFilter(txn, "suggested")) counts.suggested += 1;
    if (matchesQueueFilter(txn, "unmatched")) counts.unmatched += 1;
    if (matchesQueueFilter(txn, "duplicate")) counts.duplicate += 1;
    if (matchesQueueFilter(txn, "accepted")) counts.accepted += 1;
    if (matchesQueueFilter(txn, "rejected")) counts.rejected += 1;
  }
  return counts;
}

export function matchesReviewSearch(txn: BankTransactionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    txn.description,
    txn.reference,
    txn.suggestedAccountNo,
    txn.suggestedLearnerName,
    txn.suggestedSupplierName,
    txn.matchReason,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return hay.includes(q);
}

export function matchesConfidenceFilter(txn: BankTransactionRow, filter: ConfidenceFilter): boolean {
  if (filter === "all") return true;
  const band = txn.matchConfidence || "none";
  if (filter === "high") return band === "high";
  if (filter === "medium") return band === "medium";
  if (filter === "low") return band === "low";
  if (filter === "none") return band === "none" || !txn.matchConfidence;
  return true;
}

export function matchesTypeFilter(txn: BankTransactionRow, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  return txnType(txn) === filter;
}

export function filterReviewTransactions(
  txns: BankTransactionRow[],
  opts: {
    queue: QueueFilter;
    search: string;
    confidence: ConfidenceFilter;
    type: TypeFilter;
  }
): BankTransactionRow[] {
  return txns.filter(
    (txn) =>
      matchesQueueFilter(txn, opts.queue) &&
      matchesReviewSearch(txn, opts.search) &&
      matchesConfidenceFilter(txn, opts.confidence) &&
      matchesTypeFilter(txn, opts.type)
  );
}

export function buildReviewKpiItems(
  txns: BankTransactionRow[],
  importedTotal: number
): ReviewKpiItem[] {
  const counts = countQueueFilters(txns);
  const ready = txns.filter(canPostBankPaymentToBilling).length;
  return [
    { key: "transactions", label: "Transactions", value: counts.all },
    { key: "matched", label: "Matched", value: counts.matched },
    { key: "suggested", label: "Suggested", value: counts.suggested },
    { key: "unmatched", label: "Unmatched", value: counts.unmatched },
    { key: "duplicates", label: "Duplicates", value: counts.duplicate },
    { key: "imported", label: "Imported", value: importedTotal, money: true },
    { key: "ready", label: "Ready to Post", value: ready },
  ];
}

export function kpiReadyLabelCount(items: ReviewKpiItem[]): number {
  return items.filter((item) => /ready/i.test(item.label)).length;
}

export function buildStickyPostingModel(txns: BankTransactionRow[]): {
  selectedCount: number;
  readyAmount: number;
  canPost: boolean;
} {
  const ready = txns.filter(canPostBankPaymentToBilling);
  const readyAmount = ready.reduce((sum, txn) => sum + (txn.moneyIn || 0), 0);
  return {
    selectedCount: ready.length,
    readyAmount,
    canPost: ready.length > 0,
  };
}
