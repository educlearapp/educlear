import fs from "fs";
import path from "path";

import { resolveSchoolJsonStoreKey } from "../services/daSilvaSchoolResolve";

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
  /** Set when payment was posted from bank reconciliation. */
  bankTransactionId?: string;
  bankImportId?: string;
  source?: string;
  createdAt: string;
  /** Hidden from parent/normal statement & PDF when true. */
  statementHidden?: boolean;
  /** ISO timestamp when undone via correction journal. */
  undoneAt?: string;
  /** Correction journal entry id that offsets this row. */
  undoneByCorrectionId?: string;
  /** Original ledger entry id this correction journal reverses. */
  correctsEntryId?: string;
};

export { isKidesysOpeningBalanceEntry } from "./billingDisplayRules";

type LedgerFile = Record<string, BillingLedgerEntry[]>;

const DATA_DIR = path.join(process.cwd(), "data");
const LEDGER_FILE = path.join(DATA_DIR, "billing-ledger.json");
const LEDGER_LOCK_FILE = path.join(DATA_DIR, ".billing-ledger.lock");
const DEFAULT_PAYMENT_DUPLICATE_WINDOW_MS = 120_000;
const LEDGER_LOCK_MAX_WAIT_MS = 20_000;
const LEDGER_LOCK_STALE_MS = 30_000;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEDGER_FILE)) fs.writeFileSync(LEDGER_FILE, JSON.stringify({}, null, 2), "utf8");
}

function sleepMs(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin-wait for short lock contention */
  }
}

function clearStaleLedgerLock() {
  try {
    const stat = fs.statSync(LEDGER_LOCK_FILE);
    if (Date.now() - stat.mtimeMs > LEDGER_LOCK_STALE_MS) {
      fs.unlinkSync(LEDGER_LOCK_FILE);
    }
  } catch {
    /* no lock */
  }
}

/** Process-wide exclusive lock for billing-ledger.json read-modify-write. */
export function withBillingLedgerLock<T>(fn: () => T): T {
  const started = Date.now();
  while (Date.now() - started < LEDGER_LOCK_MAX_WAIT_MS) {
    try {
      fs.writeFileSync(LEDGER_LOCK_FILE, String(process.pid), { flag: "wx" });
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(LEDGER_LOCK_FILE);
        } catch {
          /* ignore */
        }
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      clearStaleLedgerLock();
      sleepMs(40 + Math.floor(Math.random() * 40));
    }
  }
  throw new Error("Billing ledger is busy. Please retry in a moment.");
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
  const tmp = `${LEDGER_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, LEDGER_FILE);
}

export type PaymentDuplicateFingerprint = {
  accountNo: string;
  amount: number;
  date: string;
  method?: string;
  reference?: string;
};

export function paymentDuplicateFingerprint(
  schoolId: string,
  input: PaymentDuplicateFingerprint
): string {
  const accountRef = String(input.accountNo || "").trim().toUpperCase();
  const amount = normaliseAmount(input.amount).toFixed(2);
  const date = String(input.date || "").slice(0, 10);
  const method = String(input.method || "").trim().toLowerCase();
  const reference = String(input.reference || "").trim().toLowerCase();
  return [
    String(schoolId || "").trim(),
    accountRef,
    amount,
    date,
    method,
    reference,
  ].join("|");
}

function findRecentDuplicatePayment(
  entries: BillingLedgerEntry[],
  fingerprint: string,
  windowMs: number,
  excludeId?: string
): BillingLedgerEntry | null {
  const now = Date.now();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type !== "payment") continue;
    if (excludeId && entry.id === excludeId) continue;
    const createdMs = new Date(entry.createdAt || 0).getTime();
    if (!Number.isFinite(createdMs) || now - createdMs > windowMs) continue;
    const entryFingerprint = paymentDuplicateFingerprint(entry.schoolId, {
      accountNo: entry.accountNo,
      amount: entry.amount,
      date: entry.date,
      method: entry.method,
      reference: entry.reference,
    });
    if (entryFingerprint === fingerprint) return entry;
  }
  return null;
}

export type AppendSchoolEntryResult = {
  entry: BillingLedgerEntry;
  created: boolean;
  duplicateReason?: "id" | "fingerprint" | "idempotencyKey";
};

/**
 * Atomic append with duplicate protection (double-click / concurrent save).
 */
export function appendSchoolEntrySafe(
  schoolId: string,
  entry: BillingLedgerEntry,
  opts: {
    idempotencyKey?: string;
    duplicateWindowMs?: number;
  } = {}
): AppendSchoolEntryResult {
  const sid = String(schoolId || "").trim();
  if (!sid) throw new Error("Missing schoolId");

  return withBillingLedgerLock(() => {
    const storeKey = resolveBillingLedgerStoreKey(sid);
    if (!storeKey) throw new Error("Invalid school ledger key");

    const all = readAll();
    const current = Array.isArray(all[storeKey]) ? [...all[storeKey]] : [];
    const idempotencyKey = String(opts.idempotencyKey || "").trim();
    const entryId = String(entry.id || "").trim();

    if (entryId) {
      const byId = current.find((e) => e.id === entryId);
      if (byId) {
        return { entry: byId, created: false, duplicateReason: "id" };
      }
    }

    if (idempotencyKey) {
      const stableId = `pay-${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
      const byKey = current.find((e) => e.id === stableId);
      if (byKey) {
        return { entry: byKey, created: false, duplicateReason: "idempotencyKey" };
      }
      entry = { ...entry, id: stableId };
    }

    const fingerprint = paymentDuplicateFingerprint(sid, {
      accountNo: entry.accountNo,
      amount: entry.amount,
      date: entry.date,
      method: entry.method,
      reference: entry.reference,
    });
    const windowMs = opts.duplicateWindowMs ?? DEFAULT_PAYMENT_DUPLICATE_WINDOW_MS;
    const duplicate = findRecentDuplicatePayment(current, fingerprint, windowMs, entry.id);
    if (duplicate) {
      return { entry: duplicate, created: false, duplicateReason: "fingerprint" };
    }

    current.push(entry);
    all[storeKey] = current;
    writeAll(all);
    return { entry, created: true };
  });
}

export function normaliseAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveBillingLedgerStoreKey(schoolId: string): string {
  const key = String(schoolId || "").trim();
  if (!key) return key;
  const all = readAll();
  return resolveSchoolJsonStoreKey(key, all, (value) =>
    Array.isArray(value) ? value.length > 0 : false
  );
}

export function readSchoolLedger(schoolId: string): BillingLedgerEntry[] {
  const storeKey = resolveBillingLedgerStoreKey(schoolId);
  if (!storeKey) return [];
  const all = readAll();
  return Array.isArray(all[storeKey]) ? all[storeKey] : [];
}

export function writeSchoolLedger(schoolId: string, entries: BillingLedgerEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  withBillingLedgerLock(() => {
    const storeKey = resolveBillingLedgerStoreKey(key);
    if (!storeKey) return;
    const all = readAll();
    all[storeKey] = entries;
    writeAll(all);
  });
}

export function upsertSchoolEntries(schoolId: string, entries: BillingLedgerEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key || !entries.length) return;
  withBillingLedgerLock(() => {
    const storeKey = resolveBillingLedgerStoreKey(key);
    if (!storeKey) return;
    const all = readAll();
    const current = Array.isArray(all[storeKey]) ? [...all[storeKey]] : [];
    const byId = new Map(current.map((e) => [e.id, e]));
    for (const entry of entries) byId.set(entry.id, entry);
    all[storeKey] = Array.from(byId.values());
    writeAll(all);
  });
}

export function appendSchoolEntry(schoolId: string, entry: BillingLedgerEntry) {
  appendSchoolEntrySafe(schoolId, entry);
}

export function removeSchoolEntry(schoolId: string, entryId: string): BillingLedgerEntry | null {
  const sid = String(schoolId || "").trim();
  const id = String(entryId || "").trim();
  if (!sid || !id) return null;
  return withBillingLedgerLock(() => {
    const storeKey = resolveBillingLedgerStoreKey(sid);
    if (!storeKey) return null;
    const all = readAll();
    const entries = Array.isArray(all[storeKey]) ? [...all[storeKey]] : [];
    const index = entries.findIndex((e) => e.id === id);
    if (index < 0) return null;
    const [removed] = entries.splice(index, 1);
    all[storeKey] = entries;
    writeAll(all);
    return removed;
  });
}

export function listInvoices(schoolId: string) {
  return readSchoolLedger(schoolId).filter((e) => e.type === "invoice");
}

export function listPayments(schoolId: string) {
  return readSchoolLedger(schoolId).filter((e) => e.type === "payment");
}

function admissionBaseFromAccountKey(accountKey: string): string {
  const adm = String(accountKey || "").trim();
  if (!adm) return "";
  const dash = adm.indexOf("-");
  return dash === -1 ? adm : adm.slice(0, dash);
}

export function lookupLearnerIdForAccountKey(
  accountToLearnerId: Record<string, string>,
  accountNo: string
): string {
  const ref = String(accountNo || "").trim();
  if (!ref) return "";
  if (accountToLearnerId[ref]) return accountToLearnerId[ref];
  const base = admissionBaseFromAccountKey(ref);
  if (base && accountToLearnerId[base]) return accountToLearnerId[base];
  return "";
}

/**
 * Align ledger learnerId with current learners using accountNo / admission mapping.
 * Updates missing and stale learner ids (post re-import).
 */
export function relinkLedgerLearnerIds(
  schoolId: string,
  accountToLearnerId: Record<string, string>
): number {
  const entries = readSchoolLedger(schoolId);
  if (!entries.length) return 0;
  let updated = 0;
  const next = entries.map((entry) => {
    const accountNo = String(entry.accountNo || "").trim();
    const targetId = lookupLearnerIdForAccountKey(accountToLearnerId, accountNo);
    const currentId = String(entry.learnerId || "").trim();
    if (!targetId || currentId === targetId) return entry;
    updated += 1;
    return { ...entry, learnerId: targetId };
  });
  if (updated > 0) writeSchoolLedger(schoolId, next);
  return updated;
}

/** @deprecated Use relinkLedgerLearnerIds — kept for existing scripts. */
export function backfillLedgerLearnerIds(
  schoolId: string,
  accountToLearnerId: Record<string, string>
): number {
  return relinkLedgerLearnerIds(schoolId, accountToLearnerId);
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

export type FamilyLedgerScope = {
  accountRef: string;
  learnerIds: string[];
};

/**
 * Family statement scope: learner-tagged rows only for current members;
 * account-level rows (no learnerId) only when accountNo matches accountRef.
 */
export function entryMatchesFamilyAccountScope(
  entry: BillingLedgerEntry,
  scope: FamilyLedgerScope
): boolean {
  const ref = String(scope.accountRef || "").trim();
  const learnerSet = new Set(
    (scope.learnerIds || []).map((id) => String(id).trim()).filter(Boolean)
  );
  const entryLearnerId = String(entry.learnerId || "").trim();
  const entryAccountNo = String(entry.accountNo || "").trim();

  if (entryLearnerId) {
    return learnerSet.has(entryLearnerId);
  }
  return Boolean(ref && entryAccountNo === ref);
}

/** Entries for a family billing account (statements, balances, parent portal). */
export function collectFamilyAccountEntries(
  entries: BillingLedgerEntry[],
  scope: FamilyLedgerScope
): BillingLedgerEntry[] {
  const seen = new Set<string>();
  const result: BillingLedgerEntry[] = [];

  for (const entry of entries) {
    if (!entryMatchesFamilyAccountScope(entry, scope)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }

  return result;
}

/** Ledger rows for a Kid-e-Sys billing accountRef (matches Age Analysis / balance path). */
export function collectAccountRefLedgerEntries(
  entries: BillingLedgerEntry[],
  accountRef: string
): BillingLedgerEntry[] {
  const ref = String(accountRef || "").trim().toUpperCase();
  if (!ref) return [];
  return entries.filter(
    (entry) => String(entry.accountNo || "").trim().toUpperCase() === ref
  );
}

export function getFamilyAccountLedger(
  schoolId: string,
  scope: FamilyLedgerScope
): BillingLedgerEntry[] {
  return collectFamilyAccountEntries(readSchoolLedger(schoolId), scope).sort(
    (a, b) =>
      new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
  );
}

export function calculateBalanceFromEntries(entries: BillingLedgerEntry[]): number {
  const invoiceTotal = entries
    .filter((e) => e.type === "invoice")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  const penaltyTotal = entries
    .filter((e) => e.type === "penalty")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  const paymentTotal = entries
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  const creditTotal = entries
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  return invoiceTotal + penaltyTotal - paymentTotal - creditTotal;
}

export type OpenInvoiceLine = {
  id: string;
  audit: string;
  type: string;
  date: string;
  reference: string;
  description: string;
  unpaid: number;
  amount: number;
};

/** FIFO unpaid balance per invoice/penalty line for payment allocation. */
export function computeOpenInvoiceLines(
  entries: BillingLedgerEntry[],
  learnerId: string,
  accountNo: string
): OpenInvoiceLine[] {
  const matched = accountEntries(entries, learnerId, accountNo);
  const debits = matched
    .filter((e) => e.type === "invoice" || e.type === "penalty")
    .sort((a, b) => {
      const da = new Date(a.date || a.createdAt).getTime();
      const db = new Date(b.date || b.createdAt).getTime();
      if (da !== db) return da - db;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });

  let creditPool = matched
    .filter((e) => e.type === "payment" || e.type === "credit")
    .reduce((sum, e) => sum + normaliseAmount(e.amount), 0);

  const lines: OpenInvoiceLine[] = [];
  for (const entry of debits) {
    const gross = normaliseAmount(entry.amount);
    if (gross <= 0) continue;
    const applied = Math.min(gross, creditPool);
    creditPool -= applied;
    const unpaid = gross - applied;
    if (unpaid <= 0.001) continue;
    const typeLabel = entry.type === "penalty" ? "Penalty" : "Invoice";
    lines.push({
      id: entry.id,
      audit: entry.id,
      type: typeLabel,
      date: entry.date || "",
      reference: entry.reference || typeLabel,
      description: entry.description || typeLabel,
      unpaid,
      amount: gross,
    });
  }
  return lines;
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

const MONEY_EPS = 0.001;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

type FifoDebitLine = {
  entryId: string;
  learnerId: string;
  remaining: number;
  sortTime: number;
  createdAt: string;
};

/**
 * FIFO credit pool applied to family debits; returns per-credit allocation by learner id.
 */
export function computeFifoCreditAllocationsByLearner(
  familyEntries: BillingLedgerEntry[],
  familyLearnerIds: string[]
): Map<string, Map<string, number>> {
  const learnerSet = new Set(familyLearnerIds.map((id) => String(id).trim()).filter(Boolean));
  const debits: FifoDebitLine[] = familyEntries
    .filter((e) => e.type === "invoice" || e.type === "penalty")
    .map((entry) => {
      const gross = normaliseAmount(entry.amount);
      return {
        entryId: entry.id,
        learnerId: String(entry.learnerId || "").trim(),
        remaining: gross,
        sortTime: new Date(entry.date || entry.createdAt).getTime(),
        createdAt: String(entry.createdAt || ""),
      };
    })
    .filter((d) => d.remaining > MONEY_EPS)
    .sort((a, b) => {
      if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const credits = familyEntries
    .filter((e) => e.type === "payment" || e.type === "credit")
    .map((entry) => ({
      id: entry.id,
      amount: normaliseAmount(entry.amount),
      sortTime: new Date(entry.date || entry.createdAt).getTime(),
      createdAt: String(entry.createdAt || ""),
    }))
    .filter((c) => c.amount > MONEY_EPS)
    .sort((a, b) => {
      if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const result = new Map<string, Map<string, number>>();

  for (const credit of credits) {
    let pool = credit.amount;
    const byLearner = new Map<string, number>();

    for (const debit of debits) {
      if (pool <= MONEY_EPS) break;
      if (debit.remaining <= MONEY_EPS) continue;
      const apply = Math.min(pool, debit.remaining);
      debit.remaining -= apply;
      pool -= apply;
      if (!debit.learnerId || !learnerSet.has(debit.learnerId)) continue;
      byLearner.set(debit.learnerId, roundMoney((byLearner.get(debit.learnerId) || 0) + apply));
    }

    if (byLearner.size > 0) result.set(credit.id, byLearner);
  }

  return result;
}

export type UnmergeLearnerLedgerResult = {
  updated: number;
  movedEntryIds: string[];
  splitEntryIds: string[];
  entries: BillingLedgerEntry[];
  balanceBefore: {
    schoolTotal: number;
    sourceFamily: number;
    learnerOnSource: number;
  };
  balanceAfter: {
    schoolTotal: number;
    sourceFamily: number;
    learnerOnTarget: number;
  };
};

/**
 * Move a learner's billing rows off a merged family account (never deletes entries).
 * - Learner-tagged invoices, penalties, credits, and payments move to toAccountNo.
 * - Shared payments/credits (account ref only, no learnerId) stay on fromAccountNo unless
 *   FIFO allocation attributes a portion to this learner (then split, do not delete).
 */
export function unmergeLearnerLedger(
  schoolId: string,
  opts: {
    fromAccountNo: string;
    toAccountNo: string;
    learnerId: string;
    familyLearnerIds: string[];
  }
): UnmergeLearnerLedgerResult {
  const key = String(schoolId || "").trim();
  const from = String(opts.fromAccountNo || "").trim();
  const to = String(opts.toAccountNo || "").trim();
  const learnerId = String(opts.learnerId || "").trim();
  const familyLearnerIds = opts.familyLearnerIds.map((id) => String(id).trim()).filter(Boolean);

  const emptyBalances = {
    schoolTotal: 0,
    sourceFamily: 0,
    learnerOnSource: 0,
  };
  const emptyAfter = {
    schoolTotal: 0,
    sourceFamily: 0,
    learnerOnTarget: 0,
  };

  if (!key || !from || !to || !learnerId || from === to) {
    const entries = readSchoolLedger(key);
    return {
      updated: 0,
      movedEntryIds: [],
      splitEntryIds: [],
      entries,
      balanceBefore: { ...emptyBalances, schoolTotal: calculateBalanceFromEntries(entries) },
      balanceAfter: { ...emptyAfter, schoolTotal: calculateBalanceFromEntries(entries) },
    };
  }

  const current = readSchoolLedger(key);
  const familyScope: FamilyLedgerScope = { accountRef: from, learnerIds: familyLearnerIds };
  const familyEntries = collectFamilyAccountEntries(current, familyScope);
  const fifoAllocations = computeFifoCreditAllocationsByLearner(familyEntries, familyLearnerIds);

  const balanceBefore = {
    schoolTotal: calculateBalanceFromEntries(current),
    sourceFamily: calculateBalanceFromEntries(familyEntries),
    learnerOnSource: calculateBalanceForAccount(current, learnerId, from),
  };

  const movedEntryIds: string[] = [];
  const splitEntryIds: string[] = [];
  const extraRows: BillingLedgerEntry[] = [];
  let updated = 0;

  const next = current.map((entry) => {
    const entryLearnerId = String(entry.learnerId || "").trim();
    const entryAccountNo = String(entry.accountNo || "").trim();
    const inFamily =
      entryAccountNo === from ||
      familyLearnerIds.includes(entryLearnerId) ||
      entryLearnerId === learnerId;

    if (!inFamily) return entry;

    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    const isCredit = entry.type === "payment" || entry.type === "credit";

    if (isDebit && entryLearnerId === learnerId) {
      updated += 1;
      movedEntryIds.push(entry.id);
      return { ...entry, accountNo: to };
    }

    if (entry.type === "credit" && entryLearnerId === learnerId) {
      updated += 1;
      movedEntryIds.push(entry.id);
      return { ...entry, accountNo: to };
    }

    if (isCredit) {
      if (entryLearnerId && entryLearnerId !== learnerId) {
        return entry;
      }

      if (entryLearnerId === learnerId) {
        updated += 1;
        movedEntryIds.push(entry.id);
        return { ...entry, accountNo: to };
      }

      if (!entryLearnerId && entryAccountNo === from) {
        const portion = roundMoney(fifoAllocations.get(entry.id)?.get(learnerId) || 0);
        const fullAmount = roundMoney(normaliseAmount(entry.amount));
        if (portion <= MONEY_EPS) return entry;

        if (portion >= fullAmount - MONEY_EPS) {
          updated += 1;
          movedEntryIds.push(entry.id);
          return { ...entry, accountNo: to, learnerId };
        }

        const remainder = roundMoney(fullAmount - portion);
        const splitId = `${entry.id}-unmerge-${learnerId.slice(0, 8)}`;
        splitEntryIds.push(splitId);
        extraRows.push({
          ...entry,
          id: splitId,
          amount: portion,
          accountNo: to,
          learnerId,
          description: `${entry.description || entry.type} (unmerged to ${to})`.trim(),
          createdAt: new Date().toISOString(),
        });
        updated += 1;
        return { ...entry, amount: remainder };
      }

      return entry;
    }

    return entry;
  });

  const merged = [...next, ...extraRows];
  const afterFamilyScope: FamilyLedgerScope = {
    accountRef: from,
    learnerIds: familyLearnerIds.filter((id) => id !== learnerId),
  };
  const afterFamilyEntries = collectFamilyAccountEntries(merged, afterFamilyScope);

  const balanceAfter = {
    schoolTotal: calculateBalanceFromEntries(merged),
    sourceFamily: calculateBalanceFromEntries(afterFamilyEntries),
    learnerOnTarget: calculateBalanceForAccount(merged, learnerId, to),
  };

  if (Math.abs(balanceBefore.schoolTotal - balanceAfter.schoolTotal) > 0.02) {
    throw new Error(
      `Unmerge ledger reconciliation failed: school balance ${balanceBefore.schoolTotal} → ${balanceAfter.schoolTotal}`
    );
  }

  if (updated > 0 || extraRows.length > 0) writeSchoolLedger(key, merged);

  return {
    updated: updated + extraRows.length,
    movedEntryIds,
    splitEntryIds,
    entries: merged,
    balanceBefore,
    balanceAfter,
  };
}

/**
 * Reassign accountNo on ledger rows (never deletes entries).
 * includeAccountNoOnly: also move rows that match fromAccountNo but lack a learner id (family merge).
 */
export function reassignLedgerAccountRefs(
  schoolId: string,
  opts: {
    fromAccountNo: string;
    toAccountNo: string;
    learnerIds: string[];
    includeAccountNoOnly?: boolean;
  }
): { updated: number; entries: BillingLedgerEntry[] } {
  const key = String(schoolId || "").trim();
  const from = String(opts.fromAccountNo || "").trim();
  const to = String(opts.toAccountNo || "").trim();
  if (!key || !from || !to || from === to) {
    return { updated: 0, entries: readSchoolLedger(key) };
  }

  const learnerSet = new Set(
    opts.learnerIds.map((id) => String(id).trim()).filter(Boolean)
  );
  const includeAccountNoOnly = Boolean(opts.includeAccountNoOnly);

  const current = readSchoolLedger(key);
  let updated = 0;
  const next = current.map((entry) => {
    const entryLearnerId = String(entry.learnerId || "").trim();
    const entryAccountNo = String(entry.accountNo || "").trim();
    const matchesLearner = learnerSet.has(entryLearnerId);
    const matchesAccount = includeAccountNoOnly && entryAccountNo === from;
    if (!matchesLearner && !matchesAccount) return entry;
    updated += 1;
    return { ...entry, accountNo: to };
  });

  if (updated > 0) writeSchoolLedger(key, next);
  return { updated, entries: next };
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
