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
  filterLedgerByStatementPeriod,
  normalizeStatementPeriod,
  shouldShowOpeningBalanceMigration,
} from "../utils/statementPeriod";
import { formatInvoiceChargeLinesBreakdown } from "./invoiceChargeLines";
import type { StatementPdfTransaction } from "./statementPdfTypes";
import {
  computeAgeBaselineStatementOpening,
  MIGRATION_BROUGHT_FORWARD_LABEL,
  PERIOD_BROUGHT_FORWARD_LABEL,
  partitionLedgerByAgeBaseline,
  type AgeAnalysisBaselineRef,
} from "./statementAgeBaseline";
import { roundStatementMoney } from "./statementAccounts";

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
  /** Display-only Age Analysis BBF at migration boundary (not a ledger posting). */
  isMigrationBroughtForward?: boolean;
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
  /** Display-only Age Analysis BBF row (not a ledger posting). */
  isMigrationBroughtForward?: boolean;
  /** Chronological build sequence — PDF/display tie-break; not shown in UI. */
  chronoSeq?: number;
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
  /** Optional preloaded Kid-e-Sys history for the school (bulk PDF reuse). */
  kidesysHistory?: import("../utils/kidesysTransactionHistoryStore").KidesysHistoryEntry[];
  /**
   * When set (Kid-e-Sys Age Analysis account), use B1 running-balance assembly:
   * historical imported rows keep reconstructed running balances; labelled BBF = age baseline;
   * live EduClear postings advance from that baseline to the authoritative Summary.
   */
  ageAnalysisBaseline?: { balance: number; importedAt: string };
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
 * When `ageAnalysisBaseline` is set, delegates to the same clarified B1 Manage builder so
 * Mac/browser and PDF (individual / bulk / email) share identical amounts and running balances.
 */
export function buildStatementTransactions(
  input: BuildStatementTransactionsInput
): StatementPdfTransaction[] {
  if (input.ageAnalysisBaseline) {
    const manageRows = buildStatementManageTransactions({
      ...input,
      periodFilteredEntries: input.ledgerEntries,
    });
    return manageRows.map((row) => ({
      date: row.date,
      type: row.type,
      reference: row.reference || "—",
      description: row.description || "—",
      amountIn: row.amountIn,
      amountOut: row.amountOut,
      balance: row.balance,
      learner: row.learner || undefined,
      ...(row.chargeLines ? { chargeLines: row.chargeLines } : {}),
      ...(row.chronoSeq != null ? { chronoSeq: row.chronoSeq } : {}),
      statementSection: row.isMigrationBroughtForward
        ? ("brought-forward" as const)
        : row.isImportedHistory || row.isKidesysHistory
          ? ("historical" as const)
          : ("active" as const),
    }));
  }

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

  const kidesysSource =
    input.kidesysHistory != null ? input.kidesysHistory : readSchoolKidesysHistory(schoolId);
  const kidesysAll = filterHistoryForAccount(kidesysSource, accountRef);
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

function signedEntryAmount(entry: BillingLedgerEntry): number {
  const amount = normaliseAmount(entry.amount);
  return entry.type === "invoice" || entry.type === "penalty" ? amount : -amount;
}

function entrySortTime(entry: BillingLedgerEntry): number {
  const t = new Date(entry.date || entry.createdAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Clarified B1 Manage assembly (local / approved for testing):
 * - Imported history/top-up: chronological running from 0 (reconstructed within imported set).
 * - Display-only BBF = Age Analysis baseline at the migration boundary.
 * - Live EduClear postings advance from that baseline → last running = Summary.
 */
function buildStatementManageTransactionsWithAgeBaseline(
  input: BuildStatementManageTransactionsInput,
  baseline: AgeAnalysisBaselineRef
): StatementManageTransactionRow[] {
  const { schoolId, accountRef, ledgerEntries, period, nameByLearnerId } = input;
  const showCorrectionsAudit = Boolean(input.showCorrectionsAudit);
  const normalizedPeriod = normalizeStatementPeriod(period);

  const { baselineIncluded, livePosting } = partitionLedgerByAgeBaseline(
    ledgerEntries,
    baseline.importedAt,
    { showCorrectionsAudit }
  );

  const historicalEntries = [...baselineIncluded]
    .filter((entry) => {
      if (!shouldShowOpeningBalanceMigration(normalizedPeriod, entry) && isKidesysOpeningBalanceEntry(entry)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => entrySortTime(a) - entrySortTime(b));

  type DisplayRow = StatementManageTransactionRow & { sortTime: number; chronoSeq: number };
  const historicalRows: DisplayRow[] = [];
  let histRunning = 0;
  historicalEntries.forEach((entry, index) => {
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    histRunning = roundStatementMoney(histRunning + (isDebit ? amount : -amount));
    const typeLabel = formatLedgerTypeLabel(entry);
    const sortTime = entrySortTime(entry);
    const chargeLines = snapshotChargeLines(entry);
    historicalRows.push({
      key: `hist-${entry.id}`,
      ledgerEntryId: entry.id,
      auditNo: index + 1,
      date: entry.date || "-",
      type: formatStatementManageTypeLabel(entry),
      method: entry.type === "payment" ? String(entry.method || "").trim() || "—" : "—",
      learner: resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef),
      reference: formatLedgerReferenceDisplay(entry),
      description: formatLedgerDescriptionDisplay(entry),
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: histRunning,
      isKidesysHistory: false,
      isOpeningBalance: false,
      canUndo: false,
      undoBlockedReason:
        "Imported Kid-e-Sys history is a record only. It does not affect the Age Analysis balance and cannot be undone.",
      entryType: entry.type,
      isImportedHistory: true,
      isUndone: isUndoneLedgerEntry(entry),
      sourceLabel: describeLedgerEntrySource(entry),
      ...recordedDateFor(entry),
      ...(chargeLines ? { chargeLines } : {}),
      sortTime,
      chronoSeq: index,
    });
  });

  // History-store twins not shown as ledger copies: append with continued reconstructed running.
  const shownLedgerEntries = [...historicalEntries];
  const kidesysSource =
    input.kidesysHistory != null ? input.kidesysHistory : readSchoolKidesysHistory(schoolId);
  const leftoverHistory = withoutHistoryShownByLedgerCopy(
    filterKidesysHistoryByStatementPeriod(
      filterHistoryForAccount(kidesysSource, accountRef),
      normalizedPeriod
    ),
    shownLedgerEntries
  ).sort((a, b) => new Date(a.date || "").getTime() - new Date(b.date || "").getTime());

  leftoverHistory.forEach((entry) => {
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice";
    histRunning = roundStatementMoney(histRunning + (isDebit ? amount : -amount));
    const sortTime = new Date(entry.date || "").getTime();
    const chronoSeq = historicalRows.length;
    historicalRows.push({
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
      balance: histRunning,
      isKidesysHistory: true,
      isOpeningBalance: false,
      canUndo: false,
      undoBlockedReason:
        "Imported Kid-e-Sys history is a record only. It does not affect the Age Analysis balance and cannot be undone.",
      entryType: entry.type,
      isImportedHistory: true,
      sourceLabel: "Kid-e-Sys import (historical record)",
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
      chronoSeq,
    });
  });

  const bbfBalance = computeAgeBaselineStatementOpening(
    baseline,
    ledgerEntries,
    normalizedPeriod,
    { showCorrectionsAudit }
  );
  const maxHistTime = historicalRows.reduce((m, r) => Math.max(m, r.sortTime), 0);
  const liveInPeriod = filterLedgerByStatementPeriod(livePosting, normalizedPeriod).filter((entry) => {
    if (!shouldShowOpeningBalanceMigration(normalizedPeriod, entry) && isKidesysOpeningBalanceEntry(entry)) {
      return false;
    }
    return true;
  });
  const minLiveTime = liveInPeriod.length
    ? Math.min(...liveInPeriod.map(entrySortTime))
    : maxHistTime + 2;
  const bbfSortTime =
    historicalRows.length && liveInPeriod.length
      ? (maxHistTime + minLiveTime) / 2
      : historicalRows.length
        ? maxHistTime + 1
        : minLiveTime - 1;

  const bbfLabel =
    normalizedPeriod === "All Time" ? MIGRATION_BROUGHT_FORWARD_LABEL : PERIOD_BROUGHT_FORWARD_LABEL;

  const bbfRow: DisplayRow = {
    key: `bbf-age-${accountRef}`,
    auditNo: "—",
    date: "—",
    type: "Balance brought forward",
    method: "—",
    learner: "—",
    reference: "BBF",
    description: `${bbfLabel} (Age Analysis)`,
    amountIn: 0,
    amountOut: 0,
    balance: bbfBalance,
    isKidesysHistory: false,
    isOpeningBalance: true,
    isMigrationBroughtForward: true,
    canUndo: false,
    undoBlockedReason: "Display-only Age Analysis baseline — not a ledger posting.",
    entryType: undefined,
    isImportedHistory: false,
    sourceLabel: "Age Analysis baseline (display only)",
    sortTime: bbfSortTime,
    chronoSeq: historicalRows.length,
  };

  const liveRows: DisplayRow[] = [];
  let liveRunning = bbfBalance;
  [...liveInPeriod].sort((a, b) => entrySortTime(a) - entrySortTime(b)).forEach((entry, index) => {
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    liveRunning = roundStatementMoney(liveRunning + (isDebit ? amount : -amount));
    const typeLabel = formatLedgerTypeLabel(entry);
    const undoBlockedReason = statementUndoBlockedReason(entry, typeLabel);
    const canUndo =
      canUndoStatementPostingEntry(entry, typeLabel) &&
      !isUndoneLedgerEntry(entry) &&
      !isEduClearUndoCorrectionEntry(entry) &&
      !undoBlockedReason;
    const chargeLines = snapshotChargeLines(entry);
    liveRows.push({
      key: `live-${entry.id}`,
      ledgerEntryId: entry.id,
      auditNo: index + 1,
      date: entry.date || "-",
      type: formatStatementManageTypeLabel(entry),
      method: entry.type === "payment" ? String(entry.method || "").trim() || "—" : "—",
      learner: resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef),
      reference: formatLedgerReferenceDisplay(entry),
      description: formatLedgerDescriptionDisplay(entry),
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: liveRunning,
      isKidesysHistory: false,
      isOpeningBalance: false,
      canUndo,
      undoBlockedReason: canUndo ? "" : undoBlockedReason || "This transaction cannot be undone.",
      entryType: entry.type,
      isImportedHistory: false,
      isUndone: isUndoneLedgerEntry(entry),
      sourceLabel: describeLedgerEntrySource(entry),
      ...recordedDateFor(entry),
      ...(chargeLines ? { chargeLines } : {}),
      sortTime: entrySortTime(entry),
      chronoSeq: historicalRows.length + 1 + index,
    });
  });

  // Section order (newest-first within each band) — do not interleave by date across bands.
  // Live → labelled Age Analysis BBF → historical. Overlapping hist/live dates stay separated.
  const byNewestFirst = (a: DisplayRow, b: DisplayRow) => {
    if (a.sortTime !== b.sortTime) return b.sortTime - a.sortTime;
    if (a.chronoSeq !== b.chronoSeq) return b.chronoSeq - a.chronoSeq;
    return String(a.key).localeCompare(String(b.key));
  };
  const liveNewestFirst = [...liveRows].sort(byNewestFirst);
  const histNewestFirst = [...historicalRows].sort(byNewestFirst);
  const merged = [...liveNewestFirst, bbfRow, ...histNewestFirst];

  return merged.map(({ sortTime: _sortTime, ...row }) => row);
}

/**
 * Statement Manage UI rows — same canonical logic as PDF, with undo/audit metadata.
 */
export function buildStatementManageTransactions(
  input: BuildStatementManageTransactionsInput
): StatementManageTransactionRow[] {
  if (input.ageAnalysisBaseline) {
    return buildStatementManageTransactionsWithAgeBaseline(input, input.ageAnalysisBaseline);
  }

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

  const kidesysSource =
    input.kidesysHistory != null ? input.kidesysHistory : readSchoolKidesysHistory(schoolId);
  const kidesysAll = filterHistoryForAccount(kidesysSource, accountRef);
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
