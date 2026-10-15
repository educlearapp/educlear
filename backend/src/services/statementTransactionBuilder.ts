import {
  canUndoStatementPostingEntry,
  describeLedgerEntrySource,
  formatStatementManageTypeLabel,
  isEduClearUndoCorrectionEntry,
  isImportedKidesysHistoryLedgerEntry,
  isUndoneLedgerEntry,
  statementUndoBlockedReason,
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
  type BillingInvoiceChargeLine,
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
import { formatInvoiceChargeLinesBreakdown } from "./invoiceChargeLines";
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
  /** Why undo is unavailable (empty when canUndo). */
  undoBlockedReason?: string;
  /** Ledger entry type (invoice/payment/credit/penalty) for posting rows. */
  entryType?: string;
  /** Imported Kid-e-Sys ledger copy that never affects the balance. */
  isImportedHistory?: boolean;
  isUndone?: boolean;
  /** Where the row came from (manual capture, invoice run, Kid-e-Sys import, ...). */
  sourceLabel?: string;
  /** Calendar date the row was captured/imported in EduClear when it differs from the transaction date. */
  recordedDate?: string;
  recordedLabel?: "Captured" | "Imported";
  /** Immutable invoice fee breakdown when present on the ledger entry. */
  chargeLines?: BillingInvoiceChargeLine[];
};

function recordedDateFor(entry: BillingLedgerEntry): { recordedDate?: string; recordedLabel?: "Captured" | "Imported" } {
  const recorded = String(entry.createdAt || "").slice(0, 10);
  const txnDate = String(entry.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recorded) || recorded === txnDate) return {};
  return {
    recordedDate: recorded,
    recordedLabel: isImportedKidesysHistoryLedgerEntry(entry) ? "Imported" : "Captured",
  };
}

function kidesysTransactionMatchKey(type: unknown, reference: unknown, amount: unknown, date: unknown): string {
  const ref = String(reference || "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!ref) return "";
  return [String(type || "").trim().toLowerCase(), ref, normaliseAmount(amount).toFixed(2), String(date || "").slice(0, 10)].join("|");
}

/**
 * Drops Kid-e-Sys history rows already shown through their imported ledger copy (same type,
 * reference, amount and date). Each displayed ledger copy hides at most one history row.
 */
function withoutHistoryShownByLedgerCopy(
  history: KidesysHistoryEntry[],
  shownLedgerEntries: BillingLedgerEntry[]
): KidesysHistoryEntry[] {
  const remaining = new Map<string, number>();
  for (const entry of shownLedgerEntries) {
    if (!isImportedKidesysHistoryLedgerEntry(entry)) continue;
    const key = kidesysTransactionMatchKey(entry.type, entry.reference, entry.amount, entry.date);
    if (key) remaining.set(key, (remaining.get(key) || 0) + 1);
  }
  if (!remaining.size) return history;
  return history.filter((entry) => {
    const key = kidesysTransactionMatchKey(entry.type, entry.reference || entry.kidesysReference, entry.amount, entry.date);
    const count = key ? remaining.get(key) || 0 : 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

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

function snapshotChargeLines(
  entry: BillingLedgerEntry
): BillingInvoiceChargeLine[] | undefined {
  if (!Array.isArray(entry.chargeLines) || !entry.chargeLines.length) return undefined;
  return entry.chargeLines.map((line) => ({
    lineKey: String(line.lineKey || "").trim(),
    description: String(line.description || "").trim(),
    amount: normaliseAmount(line.amount),
  }));
}

function formatPdfDescription(entry: BillingLedgerEntry): string {
  const chargeLines = snapshotChargeLines(entry);
  if (chargeLines?.length) {
    const formatMoney = (value: number) =>
      `R ${Number(value || 0).toLocaleString("en-ZA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    return formatInvoiceChargeLinesBreakdown(chargeLines, formatMoney);
  }
  return formatLedgerDescriptionDisplay(entry) || "—";
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
  const shownLedgerEntries: BillingLedgerEntry[] = [];
  const sortedPosting = [...ledgerEntries].sort(
    (a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
  );
  let running = openingBalance;
  sortedPosting.forEach((entry) => {
    if (!shouldShowLedgerEntryOnStatement(entry, showCorrectionsAudit)) return;
    if (!shouldShowOpeningBalanceMigration(period, entry) && isKidesysOpeningBalanceEntry(entry)) {
      return;
    }
    shownLedgerEntries.push(entry);
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    running += isDebit ? amount : -amount;
    const isOpeningBalance = isKidesysOpeningBalanceEntry(entry);
    const sortTime = new Date(entry.date || entry.createdAt).getTime();
    const chargeLines = snapshotChargeLines(entry);
    postingRows.push({
      key: `posting-${entry.id}`,
      date: entry.date || "—",
      type: formatLedgerTypeLabel(entry),
      reference: formatLedgerReferenceDisplay(entry) || "—",
      description: formatPdfDescription(entry),
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: running,
      learner: resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef) || undefined,
      ...(chargeLines ? { chargeLines } : {}),
      isKidesysHistory: false,
      isOpeningBalance,
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
    });
  });

  const kidesysAll = filterHistoryForAccount(readSchoolKidesysHistory(schoolId), accountRef);
  const filteredKidesys = withoutHistoryShownByLedgerCopy(
    filterKidesysHistoryByStatementPeriod(kidesysAll, period),
    shownLedgerEntries
  );

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
  const shownLedgerEntries: BillingLedgerEntry[] = [];
  const sortedPosting = [...periodFilteredEntries].sort(
    (a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
  );
  let running = openingBalance;
  sortedPosting.forEach((entry, index) => {
    if (!shouldShowLedgerEntryOnStatement(entry, showCorrectionsAudit)) return;
    if (!shouldShowOpeningBalanceMigration(period, entry) && isKidesysOpeningBalanceEntry(entry)) {
      return;
    }
    shownLedgerEntries.push(entry);
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    running += isDebit ? amount : -amount;
    const isOpeningBalance = isKidesysOpeningBalanceEntry(entry);
    const typeLabel = formatLedgerTypeLabel(entry);
    const undoBlockedReason = statementUndoBlockedReason(entry, typeLabel);
    const canUndo =
      canUndoStatementPostingEntry(entry, typeLabel) &&
      !isUndoneLedgerEntry(entry) &&
      !isEduClearUndoCorrectionEntry(entry) &&
      !undoBlockedReason;
    const learnerLabel = resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef);
    const sortTime = new Date(entry.date || entry.createdAt).getTime();
    const chargeLines = snapshotChargeLines(entry);
    postingRows.push({
      key: `posting-${entry.id}`,
      ledgerEntryId: entry.id,
      auditNo: index + 1,
      date: entry.date || "-",
      type: formatStatementManageTypeLabel(entry),
      method: entry.type === "payment" ? String(entry.method || "").trim() || "—" : "—",
      learner: learnerLabel,
      reference: formatLedgerReferenceDisplay(entry),
      description: formatLedgerDescriptionDisplay(entry),
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: running,
      isKidesysHistory: false,
      isOpeningBalance,
      canUndo,
      undoBlockedReason: canUndo ? "" : undoBlockedReason || "This transaction cannot be undone.",
      entryType: entry.type,
      isImportedHistory: isImportedKidesysHistoryLedgerEntry(entry),
      isUndone: isUndoneLedgerEntry(entry),
      sourceLabel: describeLedgerEntrySource(entry),
      ...recordedDateFor(entry),
      ...(chargeLines ? { chargeLines } : {}),
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
    });
  });

  const kidesysAll = filterHistoryForAccount(readSchoolKidesysHistory(schoolId), accountRef);
  const filteredKidesys = withoutHistoryShownByLedgerCopy(
    filterKidesysHistoryByStatementPeriod(kidesysAll, period),
    shownLedgerEntries
  );

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
      undoBlockedReason:
        "Imported Kid-e-Sys history is a record only. It does not affect the balance and cannot be undone.",
      entryType: entry.type,
      isImportedHistory: true,
      sourceLabel: "Kid-e-Sys import (historical record)",
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
