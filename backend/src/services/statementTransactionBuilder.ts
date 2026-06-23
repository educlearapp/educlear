import {
  canUndoStatementPostingEntry,
  formatKidesysHistoryDescriptionDisplay,
  formatKidesysHistoryReferenceDisplay,
  formatKidesysHistoryTypeLabel,
  formatLedgerDescriptionDisplay,
  formatLedgerReferenceDisplay,
  formatLedgerTypeLabel,
  isKidesysOpeningBalanceEntry,
  shouldShowLedgerEntryOnStatement,
} from "../utils/billingDisplayRules";
import {
  normaliseAmount,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  filterHistoryForAccount,
  readSchoolKidesysHistory,
  type KidesysHistoryEntry,
} from "../utils/kidesysTransactionHistoryStore";
import {
  filterKidesysHistoryByStatementPeriod,
  shouldShowOpeningBalanceMigration,
} from "../utils/statementPeriod";
import type { StatementPdfTransaction } from "./statementPdfTypes";

export type StatementManageTransactionRow = {
  key: string;
  ledgerEntryId?: string;
  auditNo: string | number;
  date: string;
  type: string;
  method: string;
  learner: string;
  reference: string;
  description: string;
  amountIn: number;
  amountOut: number;
  balance: number | null;
  isKidesysHistory: boolean;
  isOpeningBalance: boolean;
  canUndo: boolean;
};

type BuildStatementTransactionsInput = {
  schoolId: string;
  accountRef: string;
  ledgerEntries: BillingLedgerEntry[];
  period: string;
  nameByLearnerId: Map<string, string>;
  /** Running balance offset for transactions before the selected period. */
  openingBalance?: number;
  /** When true, include undone rows and correction journals (admin audit). */
  showCorrectionsAudit?: boolean;
};

function resolveEntryLearnerLabel(
  entry: { learnerId: string; type: string },
  nameByLearnerId: Map<string, string>,
  accountRef: string
): string {
  const learnerId = String(entry.learnerId || "").trim();
  const ref = String(accountRef || "").trim();
  if (learnerId && nameByLearnerId.has(learnerId)) {
    return nameByLearnerId.get(learnerId) || "";
  }
  if (entry.type === "payment" && (!learnerId || (ref && learnerId === ref))) {
    return "Family account";
  }
  return "";
}

/**
 * Builds statement transaction rows matching StatementManage (posting ledger + Kid-e-Sys history).
 */
export function buildStatementTransactions(
  input: BuildStatementTransactionsInput
): StatementPdfTransaction[] {
  const { schoolId, accountRef, ledgerEntries, period, nameByLearnerId } = input;
  const showCorrectionsAudit = Boolean(input.showCorrectionsAudit);
  const openingBalance = normaliseAmount(input.openingBalance ?? 0);

  type DisplayRow = Omit<StatementPdfTransaction, "balance"> & {
    key: string;
    balance: number | null;
    isKidesysHistory: boolean;
    isOpeningBalance: boolean;
    sortTime: number;
  };

  const postingRows: DisplayRow[] = [];
  const sortedPosting = [...ledgerEntries].sort(
    (a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
  );
  let running = openingBalance;
  sortedPosting.forEach((entry) => {
    if (!shouldShowLedgerEntryOnStatement(entry, showCorrectionsAudit)) return;
    if (!shouldShowOpeningBalanceMigration(period, entry) && isKidesysOpeningBalanceEntry(entry)) {
      return;
    }
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    running += isDebit ? amount : -amount;
    const isOpeningBalance = isKidesysOpeningBalanceEntry(entry);
    const sortTime = new Date(entry.date || entry.createdAt).getTime();
    postingRows.push({
      key: `posting-${entry.id}`,
      date: entry.date || "—",
      type: formatLedgerTypeLabel(entry),
      reference: formatLedgerReferenceDisplay(entry) || "—",
      description: formatLedgerDescriptionDisplay(entry) || "—",
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: running,
      learner: resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef) || undefined,
      isKidesysHistory: false,
      isOpeningBalance,
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
    });
  });

  const kidesysAll = filterHistoryForAccount(readSchoolKidesysHistory(schoolId), accountRef);
  const filteredKidesys = filterKidesysHistoryByStatementPeriod(kidesysAll, period);

  const historyRows: DisplayRow[] = filteredKidesys.map((entry) => {
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice";
    const sortTime = new Date(entry.date || "").getTime();
    return {
      key: `kidesys-${entry.id}`,
      date: entry.date || "—",
      type: formatKidesysHistoryTypeLabel(entry.type),
      reference: formatKidesysHistoryReferenceDisplay(entry),
      description: formatKidesysHistoryDescriptionDisplay(entry),
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: null,
      learner: entry.fullName || "—",
      isKidesysHistory: true,
      isOpeningBalance: false,
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
    };
  });

  const merged = [...postingRows, ...historyRows].sort((a, b) => {
    if (a.sortTime !== b.sortTime) return b.sortTime - a.sortTime;
    if (a.isKidesysHistory !== b.isKidesysHistory) return a.isKidesysHistory ? 1 : -1;
    return String(a.key).localeCompare(String(b.key));
  });

  const openingBalanceRows = merged.filter((row) => row.isOpeningBalance);
  const otherRows = merged.filter((row) => !row.isOpeningBalance);

  return [...openingBalanceRows, ...otherRows].map(
    ({ key: _key, isKidesysHistory: _h, isOpeningBalance: _o, sortTime: _s, ...row }) => row
  );
}

type BuildStatementManageTransactionsInput = BuildStatementTransactionsInput & {
  /** Period-filtered posting ledger rows (already scoped to account). */
  periodFilteredEntries: BillingLedgerEntry[];
};

/**
 * Statement Manage UI rows — same canonical logic as PDF, with undo/audit metadata.
 */
export function buildStatementManageTransactions(
  input: BuildStatementManageTransactionsInput
): StatementManageTransactionRow[] {
  const { schoolId, accountRef, periodFilteredEntries, period, nameByLearnerId } = input;
  const showCorrectionsAudit = Boolean(input.showCorrectionsAudit);
  const openingBalance = normaliseAmount(input.openingBalance ?? 0);

  type DisplayRow = StatementManageTransactionRow & { sortTime: number };

  const postingRows: DisplayRow[] = [];
  const sortedPosting = [...periodFilteredEntries].sort(
    (a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
  );
  let running = openingBalance;
  sortedPosting.forEach((entry, index) => {
    if (!shouldShowLedgerEntryOnStatement(entry, showCorrectionsAudit)) return;
    if (!shouldShowOpeningBalanceMigration(period, entry) && isKidesysOpeningBalanceEntry(entry)) {
      return;
    }
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    running += isDebit ? amount : -amount;
    const isOpeningBalance = isKidesysOpeningBalanceEntry(entry);
    const typeLabel = formatLedgerTypeLabel(entry);
    const learnerLabel = resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef);
    const sortTime = new Date(entry.date || entry.createdAt).getTime();
    postingRows.push({
      key: `posting-${entry.id}`,
      ledgerEntryId: entry.id,
      auditNo: index + 1,
      date: entry.date || "-",
      type: typeLabel,
      method: entry.type === "payment" ? String(entry.method || "").trim() || "—" : "—",
      learner: learnerLabel,
      reference: formatLedgerReferenceDisplay(entry),
      description: formatLedgerDescriptionDisplay(entry),
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: running,
      isKidesysHistory: false,
      isOpeningBalance,
      canUndo: canUndoStatementPostingEntry(entry, typeLabel),
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
    });
  });

  const kidesysAll = filterHistoryForAccount(readSchoolKidesysHistory(schoolId), accountRef);
  const filteredKidesys = filterKidesysHistoryByStatementPeriod(kidesysAll, period);

  const historyRows: DisplayRow[] = filteredKidesys.map((entry) => {
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice";
    const sortTime = new Date(entry.date || "").getTime();
    return {
      key: `kidesys-${entry.id}`,
      auditNo: "—",
      date: entry.date || "-",
      type: formatKidesysHistoryTypeLabel(entry.type),
      method: "—",
      learner: entry.fullName || "—",
      reference: formatKidesysHistoryReferenceDisplay(entry),
      description: formatKidesysHistoryDescriptionDisplay(entry),
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: null,
      isKidesysHistory: true,
      isOpeningBalance: false,
      canUndo: false,
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
    };
  });

  const merged = [...postingRows, ...historyRows].sort((a, b) => {
    if (a.sortTime !== b.sortTime) return b.sortTime - a.sortTime;
    if (a.isKidesysHistory !== b.isKidesysHistory) return a.isKidesysHistory ? 1 : -1;
    return String(a.key).localeCompare(String(b.key));
  });

  return merged.map(({ sortTime: _sortTime, ...row }) => row);
}
