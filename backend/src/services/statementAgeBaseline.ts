/**
 * B1 age-baseline helpers — shared by Manage UI and PDF (individual / bulk / email):
 * historical imported rows keep reconstructed running balances; labelled BBF = Age Analysis;
 * live EduClear postings advance from that baseline.
 *
 * Production deploy still requires explicit owner approval.
 */
import {
  filterPostImportBalanceEntries,
  roundStatementMoney,
} from "./statementAccounts";
import {
  isKidesysOpeningBalanceEntry,
  shouldShowLedgerEntryOnStatement,
} from "../utils/billingDisplayRules";
import { normaliseAmount, type BillingLedgerEntry } from "../utils/billingLedgerStore";
import {
  filterLedgerByStatementPeriod,
  normalizeStatementPeriod,
  resolveStatementPeriodCutoff,
  shouldShowOpeningBalanceMigration,
} from "../utils/statementPeriod";

export type AgeAnalysisBaselineRef = {
  /** Frozen Age Analysis snapshot balance (not current auth after live deltas). */
  balance: number;
  importedAt: string;
};

export function livePostingEntryIdSet(
  accountEntries: BillingLedgerEntry[],
  importedAt: string
): Set<string> {
  const live = filterPostImportBalanceEntries(accountEntries, importedAt);
  return new Set(live.map((e) => String(e.id || "")).filter(Boolean));
}

export function partitionLedgerByAgeBaseline(
  accountEntries: BillingLedgerEntry[],
  importedAt: string,
  options?: { showCorrectionsAudit?: boolean }
): { baselineIncluded: BillingLedgerEntry[]; livePosting: BillingLedgerEntry[] } {
  const showCorrectionsAudit = Boolean(options?.showCorrectionsAudit);
  const liveIds = livePostingEntryIdSet(accountEntries, importedAt);
  const baselineIncluded: BillingLedgerEntry[] = [];
  const livePosting: BillingLedgerEntry[] = [];

  for (const entry of accountEntries) {
    if (!shouldShowLedgerEntryOnStatement(entry, showCorrectionsAudit)) continue;
    const id = String(entry.id || "");
    if (id && liveIds.has(id)) livePosting.push(entry);
    else baselineIncluded.push(entry);
  }

  return { baselineIncluded, livePosting };
}

function signedLedgerAmount(entry: BillingLedgerEntry): number {
  const amount = normaliseAmount(entry.amount);
  const isDebit = entry.type === "invoice" || entry.type === "penalty";
  return isDebit ? amount : -amount;
}

export function sumSignedLedgerEntries(entries: BillingLedgerEntry[]): number {
  let total = 0;
  for (const entry of entries) total += signedLedgerAmount(entry);
  return roundStatementMoney(total);
}

export function computeAgeBaselineStatementOpening(
  baseline: AgeAnalysisBaselineRef,
  accountEntries: BillingLedgerEntry[],
  period: string,
  options?: { showCorrectionsAudit?: boolean }
): number {
  const ageBalance = roundStatementMoney(baseline.balance);
  const normalized = normalizeStatementPeriod(period);
  if (normalized === "All Time") return ageBalance;

  const cutoff = resolveStatementPeriodCutoff(normalized);
  if (!cutoff) return ageBalance;

  const { livePosting } = partitionLedgerByAgeBaseline(
    accountEntries,
    baseline.importedAt,
    options
  );

  let before = 0;
  for (const entry of livePosting) {
    const entryDate = new Date(entry.date || entry.createdAt);
    if (Number.isNaN(entryDate.getTime()) || entryDate >= cutoff) continue;
    before += signedLedgerAmount(entry);
  }
  return roundStatementMoney(ageBalance + before);
}

export function computeAgeBaselineStatementClosing(
  baseline: AgeAnalysisBaselineRef,
  accountEntries: BillingLedgerEntry[],
  period: string,
  options?: { showCorrectionsAudit?: boolean }
): number {
  const opening = computeAgeBaselineStatementOpening(
    baseline,
    accountEntries,
    period,
    options
  );
  const normalized = normalizeStatementPeriod(period);
  const { livePosting } = partitionLedgerByAgeBaseline(
    accountEntries,
    baseline.importedAt,
    options
  );
  const inPeriod = filterLedgerByStatementPeriod(livePosting, normalized).filter((entry) => {
    if (!shouldShowOpeningBalanceMigration(normalized, entry) && isKidesysOpeningBalanceEntry(entry)) {
      return false;
    }
    return true;
  });
  return roundStatementMoney(opening + sumSignedLedgerEntries(inPeriod));
}

export const MIGRATION_BROUGHT_FORWARD_LABEL = "Balance brought forward at migration";
export const PERIOD_BROUGHT_FORWARD_LABEL = "Balance Brought Forward";
export const HISTORICAL_SECTION_TYPE_PREFIX = "History";
