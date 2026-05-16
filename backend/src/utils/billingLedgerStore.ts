import fs from "fs";
import path from "path";

export type BillingLedgerEntryType = "invoice" | "payment" | "credit" | "penalty";

export type BillingLedgerEntry = {
  id: string;
  schoolId: string;
  learnerId: string;
  accountNo: string;
  type: BillingLedgerEntryType;
  amount: number;
  date: string;
  dueDate?: string;
  reference: string;
  description: string;
  method?: string;
  runId?: string;
  createdAt: string;
};

type LedgerFile = Record<string, BillingLedgerEntry[]>;

const DATA_DIR = path.join(process.cwd(), "data");
const LEDGER_FILE = path.join(DATA_DIR, "billing-ledger.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEDGER_FILE)) fs.writeFileSync(LEDGER_FILE, JSON.stringify({}, null, 2), "utf8");
}

function readAll(): LedgerFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(LEDGER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: LedgerFile) {
  ensureStore();
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function normaliseAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function readSchoolLedger(schoolId: string): BillingLedgerEntry[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  const all = readAll();
  return Array.isArray(all[key]) ? all[key] : [];
}

export function writeSchoolLedger(schoolId: string, entries: BillingLedgerEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  const all = readAll();
  all[key] = entries;
  writeAll(all);
}

export function upsertSchoolEntries(schoolId: string, entries: BillingLedgerEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key || !entries.length) return;
  const current = readSchoolLedger(key);
  const byId = new Map(current.map((e) => [e.id, e]));
  for (const entry of entries) byId.set(entry.id, entry);
  writeSchoolLedger(key, Array.from(byId.values()));
}

export function appendSchoolEntry(schoolId: string, entry: BillingLedgerEntry) {
  upsertSchoolEntries(schoolId, [entry]);
}

export function listInvoices(schoolId: string) {
  return readSchoolLedger(schoolId).filter((e) => e.type === "invoice");
}

export function listPayments(schoolId: string) {
  return readSchoolLedger(schoolId).filter((e) => e.type === "payment");
}

export function listPenalties(schoolId: string) {
  return readSchoolLedger(schoolId).filter((e) => e.type === "penalty");
}

export function buildPenaltyEntryId(
  schoolId: string,
  accountNo: string,
  date: string,
  description: string
) {
  const slug = String(description || "penalty")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  return `penalty-${schoolId}-${accountNo}-${date}-${slug}`;
}

function isValidCalendarYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toIsoYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Disambiguate DD/MM/YYYY vs MM/DD/YYYY (SA default when both parts <= 12). */
function slashDateToIso(first: number, second: number, year: number): string {
  const asIso = (month: number, day: number) =>
    isValidCalendarYmd(year, month, day) ? toIsoYmd(year, month, day) : "";

  if (first > 12 && second >= 1 && second <= 12) return asIso(second, first);
  if (second > 12 && first >= 1 && first <= 12) return asIso(first, second);
  if (first > 12 && second > 12) return "";

  const dmy = asIso(second, first);
  if (dmy) return dmy;
  return asIso(first, second);
}

/** Normalise to YYYY-MM-DD (handles ISO, DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD). */
export function normaliseIsoDate(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map((p) => Number(p));
    return isValidCalendarYmd(y, m, d) ? raw : "";
  }

  const slashYmd = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashYmd) {
    const iso = slashDateToIso(Number(slashYmd[1]), Number(slashYmd[2]), Number(slashYmd[3]));
    if (iso) return iso;
  }

  const ymd = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    return isValidCalendarYmd(y, m, d) ? toIsoYmd(y, m, d) : "";
  }

  if (!raw.includes("/")) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return "";
}

export function resolveEntryDueDate(
  entry: BillingLedgerEntry,
  runDueDates: Record<string, string> = {}
): string {
  const explicit = normaliseIsoDate(entry.dueDate);
  if (explicit) return explicit;

  const runId = String(entry.runId || "").trim();
  if (runId && runDueDates[runId]) {
    const fromRun = normaliseIsoDate(runDueDates[runId]);
    if (fromRun) return fromRun;
  }

  return normaliseIsoDate(entry.date);
}

/** Invoice due dates strictly before asOfDate count as overdue (due today is not overdue). */
export function isInvoicePastDue(due: string, asOfDate: string): boolean {
  const dueIso = normaliseIsoDate(due);
  const asOfIso = normaliseIsoDate(asOfDate);
  if (!dueIso || !asOfIso) return false;
  return dueIso < asOfIso;
}

export function prepareLedgerEntries(
  entries: BillingLedgerEntry[],
  runDueDates: Record<string, string> = {}
): BillingLedgerEntry[] {
  return entries.map((entry) => {
    if (entry.type !== "invoice") return entry;
    const dueDate = resolveEntryDueDate(entry, runDueDates);
    if (!dueDate || dueDate === entry.dueDate) return entry;
    return { ...entry, dueDate };
  });
}

function entryDueDate(entry: BillingLedgerEntry, runDueDates: Record<string, string> = {}): string {
  return resolveEntryDueDate(entry, runDueDates);
}

export function accountEntries(
  entries: BillingLedgerEntry[],
  learnerId: string,
  accountNo: string
) {
  const keys = new Set(
    [learnerId, accountNo].filter((v) => v && v !== "-").map((v) => String(v).trim())
  );
  return entries.filter(
    (e) => keys.has(String(e.learnerId || "").trim()) || keys.has(String(e.accountNo || "").trim())
  );
}

export type OverdueInvoiceLine = {
  id: string;
  dueDate: string;
  invoiceDate: string;
  amount: number;
  reference: string;
  description: string;
};

export function listOverdueInvoicesForAccount(
  entries: BillingLedgerEntry[],
  learnerId: string,
  accountNo: string,
  asOfDate: string,
  runDueDates: Record<string, string> = {}
): OverdueInvoiceLine[] {
  const matched = accountEntries(entries, learnerId, accountNo);
  const asOfIso = normaliseIsoDate(asOfDate);
  return matched
    .filter((e) => e.type === "invoice")
    .map((entry) => {
      const due = entryDueDate(entry, runDueDates);
      const amount = normaliseAmount(entry.amount);
      if (!amount || !due || !isInvoicePastDue(due, asOfIso)) return null;
      return {
        id: entry.id,
        dueDate: due,
        invoiceDate: normaliseIsoDate(entry.date),
        amount,
        reference: String(entry.reference || ""),
        description: String(entry.description || "School fees"),
      };
    })
    .filter((row): row is OverdueInvoiceLine => Boolean(row))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function computeAccountOverdue(
  entries: BillingLedgerEntry[],
  learnerId: string,
  accountNo: string,
  options: {
    penaltyDate: string;
    dueDateCutoff: string;
    excludeNotYetDue: boolean;
    runDueDates?: Record<string, string>;
  }
) {
  const matched = accountEntries(entries, learnerId, accountNo);
  const asOf = normaliseIsoDate(options.penaltyDate || options.dueDateCutoff);

  let overdueAmount = 0;
  let excludedNotYetDue = 0;

  for (const entry of matched.filter((e) => e.type === "invoice")) {
    const amount = normaliseAmount(entry.amount);
    if (!amount) continue;
    const due = entryDueDate(entry, options.runDueDates);
    if (!due) continue;

    if (options.excludeNotYetDue && !isInvoicePastDue(due, asOf)) {
      excludedNotYetDue += amount;
      continue;
    }
    if (isInvoicePastDue(due, asOf)) overdueAmount += amount;
  }

  const balance = calculateBalanceForAccount(entries, learnerId, accountNo);
  return { balance, overdueAmount, excludedNotYetDue };
}

/** Shared legal-recovery overdue resolver (Section 41, Letter of Demand, Final Demand). */
export function computeLegalOverdueSnapshot(
  entries: BillingLedgerEntry[],
  learnerId: string,
  accountNo: string,
  asOfDate: string,
  runDueDates?: Record<string, string>
) {
  const date = normaliseIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);
  const { balance, overdueAmount, excludedNotYetDue } = computeAccountOverdue(
    entries,
    learnerId,
    accountNo,
    { penaltyDate: date, dueDateCutoff: date, excludeNotYetDue: true, runDueDates }
  );
  let overdueInvoices = listOverdueInvoicesForAccount(
    entries,
    learnerId,
    accountNo,
    date,
    runDueDates
  );
  let overdueBalance =
    balance > 0 && overdueAmount > 0 ? Math.min(balance, overdueAmount) : 0;

  // Align with Statements legal eligibility: owing account + latest invoice due in the past
  if (overdueBalance <= 0 && balance > 0) {
    const matched = accountEntries(entries, learnerId, accountNo);
    let latestDue = "";
    for (const entry of matched.filter((e) => e.type === "invoice")) {
      const due = entryDueDate(entry, runDueDates);
      if (due && (!latestDue || due > latestDue)) latestDue = due;
    }
    if (latestDue && isInvoicePastDue(latestDue, date)) {
      overdueBalance = balance;
      if (!overdueInvoices.length) {
        overdueInvoices = [
          {
            id: `fallback-${learnerId}`,
            dueDate: latestDue,
            invoiceDate: latestDue,
            amount: balance,
            reference: "",
            description: "Outstanding school fees",
          },
        ];
      }
    }
  }

  return { balance, overdueAmount, overdueBalance, excludedNotYetDue, overdueInvoices };
}

export function calculateBalanceForAccount(
  entries: BillingLedgerEntry[],
  learnerId: string,
  accountNo: string
): number {
  const keys = new Set(
    [learnerId, accountNo].filter((v) => v && v !== "-").map((v) => String(v).trim())
  );
  const matched = entries.filter(
    (e) => keys.has(String(e.learnerId || "").trim()) || keys.has(String(e.accountNo || "").trim())
  );
  const invoiceTotal = matched
    .filter((e) => e.type === "invoice")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  const penaltyTotal = matched
    .filter((e) => e.type === "penalty")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  const paymentTotal = matched
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  const creditTotal = matched
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  return invoiceTotal + penaltyTotal - paymentTotal - creditTotal;
}
