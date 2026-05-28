export type KidesysHistoryEntryType = "invoice" | "payment";

export const KIDESYS_DISPLAY_HISTORY_SOURCE = "kidesys_display_history" as const;

export type KidesysHistoryDirection = "debit" | "credit";

export type KidesysHistoryEntry = {
  id: string;
  schoolId: string;
  accountNo: string;
  type: KidesysHistoryEntryType;
  amount: number;
  date: string;
  reference: string;
  transactionNo: string;
  description: string;
  fullName: string;
  source: typeof KIDESYS_DISPLAY_HISTORY_SOURCE;
  importedAt: string;
  invoiceNumber?: string;
  paymentNumber?: string;
  journalReference?: string;
  kidesysReference?: string;
  direction?: KidesysHistoryDirection;
  sourceFileRow?: number;
};

export const KIDESYS_HISTORY_UPDATED_EVENT = "educlear-kidesys-history-updated";

/** In-memory Kid-e-Sys history from API (source of truth for display). */
const memoryHistoryBySchool: Record<string, KidesysHistoryEntry[]> = {};

/** In-memory statement overview fields from GET /api/statements. */
const memorySummariesBySchool: Record<string, Record<string, StatementApiSummary>> = {};

/** Full statement account rows from GET /api/statements (Age Analysis source of truth). */
const memoryStatementAccountsBySchool: Record<string, unknown[]> = {};

export function notifyKidesysHistoryUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(KIDESYS_HISTORY_UPDATED_EVENT));
  }
}

export function readSchoolKidesysHistory(schoolId: string): KidesysHistoryEntry[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  return Array.isArray(memoryHistoryBySchool[key]) ? memoryHistoryBySchool[key] : [];
}

export function writeSchoolKidesysHistory(schoolId: string, entries: KidesysHistoryEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  memoryHistoryBySchool[key] = entries;
  notifyKidesysHistoryUpdated();
}

export function clearSchoolBillingDisplayCache(schoolId: string) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  delete memoryHistoryBySchool[key];
  delete memorySummariesBySchool[key];
  delete memoryStatementAccountsBySchool[key];
}

export function writeStatementApiAccounts(schoolId: string, rows: unknown[]) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  memoryStatementAccountsBySchool[key] = Array.isArray(rows) ? rows : [];
  notifyKidesysHistoryUpdated();
}

export function readStatementApiAccounts(schoolId: string): unknown[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  return Array.isArray(memoryStatementAccountsBySchool[key])
    ? memoryStatementAccountsBySchool[key]
    : [];
}

export function filterHistoryForAccount(
  entries: KidesysHistoryEntry[],
  accountNo: string
): KidesysHistoryEntry[] {
  const ref = String(accountNo || "").trim();
  if (!ref) return [];
  return entries.filter((e) => String(e.accountNo || "").trim() === ref);
}

export type KidesysHistoryAccountSummary = {
  lastInvoice: KidesysHistoryEntry | null;
  lastPayment: KidesysHistoryEntry | null;
};

export function buildKidesysHistoryAccountIndex(
  entries: KidesysHistoryEntry[]
): Map<string, KidesysHistoryAccountSummary> {
  const index = new Map<string, KidesysHistoryAccountSummary>();
  const entryTime = (e: KidesysHistoryEntry) => {
    const d = new Date(e.date || "");
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  };

  for (const entry of entries) {
    const accountNo = String(entry.accountNo || "").trim();
    if (!accountNo) continue;
    const current = index.get(accountNo) || { lastInvoice: null, lastPayment: null };
    if (entry.type === "invoice") {
      if (!current.lastInvoice || entryTime(entry) >= entryTime(current.lastInvoice)) {
        current.lastInvoice = entry;
      }
    } else if (entry.type === "payment") {
      if (!current.lastPayment || entryTime(entry) >= entryTime(current.lastPayment)) {
        current.lastPayment = entry;
      }
    }
    index.set(accountNo, current);
  }

  return index;
}

export function getHistorySummaryForAccount(
  entries: KidesysHistoryEntry[],
  accountNo: string
): KidesysHistoryAccountSummary {
  const scoped = filterHistoryForAccount(entries, accountNo);
  const index = buildKidesysHistoryAccountIndex(scoped);
  return index.get(String(accountNo || "").trim()) || { lastInvoice: null, lastPayment: null };
}

export type StatementApiSummary = {
  lastInvoice: number;
  lastInvoiceDate: string;
  lastInvoiceLabel: string | null;
  lastPayment: number;
  lastPaymentDate: string;
};

export function writeStatementApiSummaries(
  schoolId: string,
  rows: Array<StatementApiSummary & { accountNo: string }>
) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  const byAccount: Record<string, StatementApiSummary> = {};
  for (const row of rows) {
    const accountNo = String(row.accountNo || "").trim();
    if (!accountNo) continue;
    byAccount[accountNo] = {
      lastInvoice: Number(row.lastInvoice) || 0,
      lastInvoiceDate: String(row.lastInvoiceDate || ""),
      lastInvoiceLabel: row.lastInvoiceLabel ?? null,
      lastPayment: Number(row.lastPayment) || 0,
      lastPaymentDate: String(row.lastPaymentDate || ""),
    };
  }
  memorySummariesBySchool[key] = byAccount;
  notifyKidesysHistoryUpdated();
}

export function readStatementApiSummary(
  schoolId: string,
  accountNo: string
): StatementApiSummary | null {
  const key = String(schoolId || "").trim();
  const ref = String(accountNo || "").trim();
  if (!key || !ref) return null;
  return memorySummariesBySchool[key]?.[ref] ?? null;
}

export function mapApiRowToHistoryEntry(schoolId: string, row: any): KidesysHistoryEntry {
  const type = String(row.type || "invoice").toLowerCase();
  const entryType: KidesysHistoryEntryType = type === "payment" ? "payment" : "invoice";
  const directionRaw = String(row.direction || "").toLowerCase();
  const direction: KidesysHistoryDirection | undefined =
    directionRaw === "debit" || directionRaw === "credit" ? directionRaw : undefined;
  return {
    id: String(row.id),
    schoolId,
    accountNo: String(row.accountNo || ""),
    type: entryType,
    amount: Number(row.amount || 0),
    date: String(row.date || "").slice(0, 10),
    reference: String(row.reference || ""),
    transactionNo: String(row.transactionNo || ""),
    description: String(row.description || row.reference || ""),
    fullName: String(row.fullName || ""),
    source: KIDESYS_DISPLAY_HISTORY_SOURCE,
    importedAt: String(row.importedAt || new Date().toISOString()),
    invoiceNumber: row.invoiceNumber ? String(row.invoiceNumber) : undefined,
    paymentNumber: row.paymentNumber ? String(row.paymentNumber) : undefined,
    journalReference: row.journalReference ? String(row.journalReference) : undefined,
    kidesysReference: row.kidesysReference ? String(row.kidesysReference) : undefined,
    direction,
    sourceFileRow: Number.isFinite(Number(row.sourceFileRow))
      ? Number(row.sourceFileRow)
      : undefined,
  };
}
