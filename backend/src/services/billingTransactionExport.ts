import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import {
  formatLedgerDescriptionDisplay,
  formatLedgerReferenceDisplay,
  formatLedgerTypeLabel,
  shouldShowLedgerEntryOnStatement,
} from "../utils/billingDisplayRules";
import {
  dateInInclusiveRange,
  ledgerEntryCalendarDate,
  resolveTransactionListDateRange,
  type TransactionListDateSelection,
} from "../utils/billingReportDateRange";
import { readSchoolLedger, type BillingLedgerEntry } from "../utils/billingLedgerStore";

export type TransactionListTypeFilter =
  | "All"
  | "Payments"
  | "Invoices"
  | "Credits"
  | "Penalties";

export type TransactionExportFilters = {
  type: TransactionListTypeFilter;
  dateSelection?: TransactionListDateSelection;
  fromDate?: string;
  toDate?: string;
  hideCorrections?: boolean;
};

export type TransactionExportRow = {
  id: string;
  date: string;
  type: string;
  accountNo: string;
  accountHolder: string;
  learners: string;
  description: string;
  reference: string;
  amount: number;
  source: string;
  createdAt: string;
};

export type TransactionExportResult = {
  fromDate: string;
  toDate: string;
  type: TransactionListTypeFilter;
  count: number;
  totalAmount: number;
  rows: TransactionExportRow[];
};

function normaliseAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100) / 100;
}

function matchesTypeFilter(entry: BillingLedgerEntry, type: TransactionListTypeFilter): boolean {
  if (type === "All") return true;
  if (type === "Payments") return entry.type === "payment";
  if (type === "Invoices") return entry.type === "invoice";
  if (type === "Credits") return entry.type === "credit";
  if (type === "Penalties") return entry.type === "penalty";
  return true;
}

function shouldHideCorrectionEntry(
  entry: BillingLedgerEntry,
  hideCorrections: boolean
): boolean {
  if (!hideCorrections) return false;
  return !shouldShowLedgerEntryOnStatement(entry, false);
}

function resolveDateBounds(filters: TransactionExportFilters): {
  fromDate: string;
  toDate: string;
} {
  if (filters.fromDate && filters.toDate) {
    return { fromDate: filters.fromDate, toDate: filters.toDate };
  }
  const resolved = resolveTransactionListDateRange(
    filters.dateSelection || "This Month",
    filters.fromDate,
    filters.toDate
  );
  return { fromDate: resolved.fromDate, toDate: resolved.toDate };
}

export function filterLedgerForTransactionExport(
  entries: BillingLedgerEntry[],
  filters: TransactionExportFilters
): BillingLedgerEntry[] {
  const { fromDate, toDate } = resolveDateBounds(filters);
  const hideCorrections = Boolean(filters.hideCorrections);

  return entries.filter((entry) => {
    if (!matchesTypeFilter(entry, filters.type)) return false;
    if (shouldHideCorrectionEntry(entry, hideCorrections)) return false;
    const calendarDate = ledgerEntryCalendarDate(entry);
    if (!calendarDate) return false;
    return dateInInclusiveRange(calendarDate, fromDate, toDate);
  });
}

type AccountMeta = {
  accountHolder: string;
  learners: string;
};

async function buildAccountMetaIndex(schoolId: string): Promise<Map<string, AccountMeta>> {
  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const index = new Map<string, AccountMeta>();

  for (const row of accounts) {
    const accountNo = String(row.accountNo || "").trim().toUpperCase();
    if (!accountNo) continue;
    const learners =
      Array.isArray(row.memberNames) && row.memberNames.length
        ? row.memberNames.join(" · ")
        : `${row.name || ""} ${row.surname || ""}`.trim() || "—";
    index.set(accountNo, {
      accountHolder: String(row.accountHolder || row.familyName || "—").trim() || "—",
      learners: learners || "—",
    });
  }

  return index;
}

export async function buildTransactionExport(
  schoolId: string,
  filters: TransactionExportFilters,
  opts: { ledger?: BillingLedgerEntry[] } = {}
): Promise<TransactionExportResult> {
  const sid = String(schoolId || "").trim();
  const { fromDate, toDate } = resolveDateBounds(filters);
  const ledger = opts.ledger ?? readSchoolLedger(sid);
  const filtered = filterLedgerForTransactionExport(ledger, {
    ...filters,
    fromDate,
    toDate,
  });

  const accountIndex = await buildAccountMetaIndex(sid);

  const rows: TransactionExportRow[] = filtered
    .map((entry) => {
      const accountNo = String(entry.accountNo || "").trim().toUpperCase();
      const meta = accountIndex.get(accountNo);
      const amount = normaliseAmount(entry.amount);

      return {
        id: entry.id,
        date: ledgerEntryCalendarDate(entry),
        type: formatLedgerTypeLabel(entry),
        accountNo,
        accountHolder: meta?.accountHolder || "—",
        learners: meta?.learners || "—",
        description: formatLedgerDescriptionDisplay(entry) || "—",
        reference: formatLedgerReferenceDisplay(entry) || String(entry.reference || "—"),
        amount,
        source: String(entry.source || "—").trim() || "—",
        createdAt: String(entry.createdAt || "").trim() || "—",
      };
    })
    .sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp) return dateCmp;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const totalAmount =
    Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;

  return {
    fromDate,
    toDate,
    type: filters.type,
    count: rows.length,
    totalAmount,
    rows,
  };
}

/** Payment-only export for reconciliation scripts (unsigned positive amounts). */
export async function buildPaymentReconciliationExport(
  schoolId: string,
  fromDate: string,
  toDate: string,
  opts: { ledger?: BillingLedgerEntry[] } = {}
): Promise<TransactionExportResult> {
  const result = await buildTransactionExport(
    schoolId,
    {
      type: "Payments",
      fromDate,
      toDate,
      hideCorrections: true,
    },
    opts
  );

  return result;
}
