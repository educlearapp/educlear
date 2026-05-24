import fs from "fs";
import path from "path";

import { resolveSchoolJsonStoreKey } from "../services/daSilvaSchoolResolve";

export type KidesysHistoryEntryType = "invoice" | "payment";

export const KIDESYS_DISPLAY_HISTORY_SOURCE = "kidesys_display_history" as const;

export type KidesysHistoryDirection = "debit" | "credit";

/** Non-posting Kid-e-Sys transaction rows (display / last invoice-payment only). */
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
  /** Invoice number when type is invoice. */
  invoiceNumber?: string;
  /** Receipt/payment number when type is payment. */
  paymentNumber?: string;
  /** Journal or free-text reference from Kid-e-Sys column 5. */
  journalReference?: string;
  /** Original Kid-e-Sys reference label (e.g. "Invoice 42225"). */
  kidesysReference?: string;
  direction?: KidesysHistoryDirection;
  /** 1-based row index in transaction_list.xls. */
  sourceFileRow?: number;
};

type HistoryFile = Record<string, KidesysHistoryEntry[]>;

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "kidesys-transaction-history.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

function readAll(): HistoryFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: HistoryFile) {
  ensureStore();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function normaliseHistoryAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function readSchoolKidesysHistory(schoolId: string): KidesysHistoryEntry[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  const all = readAll();
  const storeKey = resolveSchoolJsonStoreKey(key, all, (value) =>
    Array.isArray(value) ? value.length > 0 : false
  );
  return Array.isArray(all[storeKey]) ? all[storeKey] : [];
}

export function writeSchoolKidesysHistory(schoolId: string, entries: KidesysHistoryEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  const all = readAll();
  all[key] = entries;
  writeAll(all);
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

/** Latest invoice/payment per account (by transaction date). */
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
