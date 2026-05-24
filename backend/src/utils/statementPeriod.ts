import type { BillingLedgerEntry } from "./billingLedgerStore";
import type { KidesysHistoryEntry } from "./kidesysTransactionHistoryStore";
import { isKidesysOpeningBalanceEntry } from "./billingDisplayRules";

export const DEFAULT_STATEMENT_PERIOD = "Last 3 Months";

export const STATEMENT_PERIOD_OPTIONS = [
  "Last 3 Months",
  "Last 6 Months",
  "Last 12 Months",
  "Last 18 Months",
  "Last 24 Months",
  "All Time",
] as const;

export type StatementPeriodOption = (typeof STATEMENT_PERIOD_OPTIONS)[number];

const MONTHS_BY_PERIOD: Record<string, number> = {
  "Last 3 Months": 3,
  "Last 6 Months": 6,
  "Last 12 Months": 12,
  "Last 18 Months": 18,
  "Last 24 Months": 24,
};

const LEGACY_PERIOD_MAP: Record<string, StatementPeriodOption> = {
  "Last 10 Transactions": "Last 3 Months",
  "Last 9 Months": "Last 12 Months",
  "This Year": "Last 12 Months",
};

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function normalizeStatementPeriod(period?: string | null): StatementPeriodOption {
  const raw = String(period || "").trim();
  if (!raw) return DEFAULT_STATEMENT_PERIOD;
  if (LEGACY_PERIOD_MAP[raw]) return LEGACY_PERIOD_MAP[raw];
  if ((STATEMENT_PERIOD_OPTIONS as readonly string[]).includes(raw)) {
    return raw as StatementPeriodOption;
  }
  return DEFAULT_STATEMENT_PERIOD;
}

export function resolveStatementPeriodCutoff(
  period: string,
  now: Date = new Date()
): Date | null {
  const normalized = normalizeStatementPeriod(period);
  if (normalized === "All Time") return null;
  const months = MONTHS_BY_PERIOD[normalized];
  if (!months) return null;
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

export function isDateInStatementPeriod(
  dateRaw: string | undefined | null,
  period: string,
  now: Date = new Date()
): boolean {
  const normalized = normalizeStatementPeriod(period);
  if (normalized === "All Time") return true;
  const cutoff = resolveStatementPeriodCutoff(normalized, now);
  if (!cutoff) return true;
  const entryDate = new Date(String(dateRaw || "").trim());
  if (Number.isNaN(entryDate.getTime())) return false;
  return entryDate >= cutoff;
}

export function formatStatementPeriodHeaderLabel(period: string, now: Date = new Date()): string {
  const normalized = normalizeStatementPeriod(period);
  if (normalized === "All Time") return "All Time";

  const cutoff = resolveStatementPeriodCutoff(normalized, now);
  if (!cutoff) return normalized;

  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  return `${normalized} (${formatDisplayDate(cutoff)} – ${formatDisplayDate(end)})`;
}

export function filterLedgerByStatementPeriod(
  entries: BillingLedgerEntry[],
  period: string
): BillingLedgerEntry[] {
  const normalized = normalizeStatementPeriod(period);
  if (normalized === "All Time") return entries;

  return entries.filter((entry) =>
    isDateInStatementPeriod(entry.date || entry.createdAt, normalized)
  );
}

export function filterKidesysHistoryByStatementPeriod(
  entries: KidesysHistoryEntry[],
  period: string
): KidesysHistoryEntry[] {
  const normalized = normalizeStatementPeriod(period);
  if (normalized === "All Time") return entries;

  return entries.filter((entry) => isDateInStatementPeriod(entry.date, normalized));
}

export function shouldShowOpeningBalanceMigration(
  period: string,
  entry: Pick<BillingLedgerEntry, "source" | "reference" | "description" | "date" | "createdAt">
): boolean {
  if (!isKidesysOpeningBalanceEntry(entry)) return false;
  const normalized = normalizeStatementPeriod(period);
  if (normalized === "All Time") return true;
  return isDateInStatementPeriod(entry.date || entry.createdAt, normalized);
}
