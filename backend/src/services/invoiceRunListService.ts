import {
  isEduClearUndoCorrectionEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  listInvoices,
  normaliseAmount,
  normalizeInvoicePeriod,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

export type InvoiceRunListSource = "ledger";

export type InvoiceRunListItem = {
  id: string;
  runId: string;
  source: InvoiceRunListSource;
  description: string;
  period: string;
  month: string;
  invoicePeriod: string;
  date: string;
  invoiceDate: string;
  dueDate: string;
  totalInvoices: number;
  totalAmount: number;
  executed: true;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normaliseIsoDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const slash = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
  }
  return raw.slice(0, 10);
}

export function formatInvoicePeriodLabel(invoicePeriod: string): string {
  const period = String(invoicePeriod || "").trim();
  const match = period.match(/^(\d{4})-(\d{2})$/);
  if (!match) return period;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return period;
  return `${MONTH_NAMES[monthIndex]} ${match[1]}`;
}

function resolveInvoicePeriod(entry: BillingLedgerEntry): string {
  const fromField = String(entry.invoicePeriod || "").trim();
  if (/^\d{4}-\d{2}$/.test(fromField)) return fromField;
  const fromDate = normaliseIsoDate(entry.date).slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(fromDate)) return fromDate;
  return normalizeInvoicePeriod(
    fromField || String(entry.description || ""),
    normaliseIsoDate(entry.date)
  );
}

function isActiveInvoiceEntry(entry: BillingLedgerEntry): boolean {
  if (entry.type !== "invoice") return false;
  if (isUndoneLedgerEntry(entry)) return false;
  if (isEduClearUndoCorrectionEntry(entry)) return false;
  return true;
}

function resolveGroupKey(entry: BillingLedgerEntry): string {
  const runId = String(entry.runId || "").trim();
  if (runId) return `run:${runId}`;

  const invoicePeriod = resolveInvoicePeriod(entry);
  const date = normaliseIsoDate(entry.date);
  const description = String(entry.description || "").trim().toLowerCase();
  return `legacy:${invoicePeriod}:${date}:${description}`;
}

function resolveRunIdFromGroupKey(groupKey: string, entries: BillingLedgerEntry[]): string {
  const fromEntry = entries.find((entry) => String(entry.runId || "").trim());
  if (fromEntry) return String(fromEntry.runId || "").trim();
  if (groupKey.startsWith("run:")) return groupKey.slice(4);
  return groupKey;
}

function pickDescription(entries: BillingLedgerEntry[]): string {
  const withDescription = entries.find((entry) => String(entry.description || "").trim());
  if (withDescription) return String(withDescription.description).trim();
  const period = resolveInvoicePeriod(entries[0]);
  const label = formatInvoicePeriodLabel(period);
  return label ? `Invoice Run For ${label}` : "Invoice Run";
}

function pickDueDate(entries: BillingLedgerEntry[]): string {
  for (const entry of entries) {
    const due = normaliseIsoDate(entry.dueDate);
    if (due) return due;
  }
  return "";
}

function pickInvoiceDate(entries: BillingLedgerEntry[]): string {
  const dates = entries
    .map((entry) => normaliseIsoDate(entry.date))
    .filter(Boolean)
    .sort();
  return dates[0] || "";
}

/**
 * Read-only invoice run summaries derived from posted billing-ledger invoice rows.
 * Groups by runId when present; otherwise by period + invoice date + description.
 */
export function listInvoiceRunsFromLedger(
  schoolId: string,
  opts: { ledger?: BillingLedgerEntry[] } = {}
): InvoiceRunListItem[] {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];

  const invoices = (opts.ledger ?? listInvoices(sid)).filter(isActiveInvoiceEntry);
  const grouped = new Map<string, BillingLedgerEntry[]>();

  for (const entry of invoices) {
    const key = resolveGroupKey(entry);
    const bucket = grouped.get(key) || [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  const runs: InvoiceRunListItem[] = [];

  for (const [groupKey, entries] of grouped.entries()) {
    const runId = resolveRunIdFromGroupKey(groupKey, entries);
    const invoicePeriod = resolveInvoicePeriod(entries[0]);
    const periodLabel = formatInvoicePeriodLabel(invoicePeriod);
    const invoiceDate = pickInvoiceDate(entries);
    const description = pickDescription(entries);
    const totalAmount = roundMoney(
      entries.reduce((sum, entry) => sum + normaliseAmount(entry.amount), 0)
    );

    runs.push({
      id: runId || groupKey,
      runId: runId || groupKey,
      source: "ledger",
      description,
      period: periodLabel,
      month: periodLabel,
      invoicePeriod,
      date: invoiceDate.replace(/-/g, "/"),
      invoiceDate,
      dueDate: pickDueDate(entries),
      totalInvoices: entries.length,
      totalAmount,
      executed: true,
    });
  }

  return runs.sort((a, b) => {
    const aTime = Date.parse(a.invoiceDate || a.date || "") || 0;
    const bTime = Date.parse(b.invoiceDate || b.date || "") || 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(b.runId).localeCompare(String(a.runId));
  });
}

/** Count active invoice rows per YYYY-MM period (for filtering browser-only ghost drafts). */
export function countInvoicesByPeriod(
  schoolId: string,
  opts: { ledger?: BillingLedgerEntry[] } = {}
): Record<string, number> {
  const sid = String(schoolId || "").trim();
  if (!sid) return {};

  const counts: Record<string, number> = {};
  const invoices = (opts.ledger ?? listInvoices(sid)).filter(isActiveInvoiceEntry);
  for (const entry of invoices) {
    const period = resolveInvoicePeriod(entry);
    if (!period) continue;
    counts[period] = (counts[period] || 0) + 1;
  }
  return counts;
}
