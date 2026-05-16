import { getLearnerAccountNo } from "../learner/learnerIdentity";

export type BillingLedgerEntryType = "invoice" | "payment" | "credit";

export type BillingLedgerEntry = {
  id: string;
  schoolId: string;
  learnerId: string;
  accountNo: string;
  type: BillingLedgerEntryType;
  amount: number;
  date: string;
  reference: string;
  description: string;
  method?: string;
  runId?: string;
  createdAt: string;
};

export type BillingAccountRow = {
  id: string;
  learnerId: string;
  accountNo: string;
  name: string;
  surname: string;
  balance: number;
  invoiceTotal: number;
  paymentTotal: number;
  creditTotal: number;
  lastInvoice: string;
  lastInvoiceDate: string;
  lastPayment: string;
  lastPaymentDate: string;
  status: string;
};

const LEDGER_STORAGE_KEY = "educlearBillingLedger";
const MIGRATED_FLAG_PREFIX = "educlearBillingLedgerMigrated:";

export const BILLING_UPDATED_EVENT = "educlear-billing-updated";

export function notifyBillingUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BILLING_UPDATED_EVENT));
  }
}

export function normaliseBillingAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value: unknown): string {
  return `R ${normaliseBillingAmount(value).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readAllLedgers(): Record<string, BillingLedgerEntry[]> {
  const data = readJson<Record<string, BillingLedgerEntry[]>>(LEDGER_STORAGE_KEY, {});
  return data && typeof data === "object" ? data : {};
}

function writeAllLedgers(data: Record<string, BillingLedgerEntry[]>) {
  writeJson(LEDGER_STORAGE_KEY, data);
}

function readSchoolLedgerRaw(schoolId: string): BillingLedgerEntry[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  const all = readAllLedgers();
  return Array.isArray(all[key]) ? all[key] : [];
}

export function readSchoolLedger(schoolId: string): BillingLedgerEntry[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  migrateLegacyLedgerIfNeeded(key);
  return readSchoolLedgerRaw(key);
}

export function writeSchoolLedger(schoolId: string, entries: BillingLedgerEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  const all = readAllLedgers();
  all[key] = entries;
  writeAllLedgers(all);
  notifyBillingUpdated();
}

export function upsertSchoolEntries(schoolId: string, entries: BillingLedgerEntry[]) {
  const key = String(schoolId || "").trim();
  if (!key || !entries.length) return;
  const current = readSchoolLedger(key);
  const byId = new Map(current.map((e) => [e.id, e]));
  for (const entry of entries) byId.set(entry.id, entry);
  writeSchoolLedger(key, Array.from(byId.values()));
}

function accountKeys(learnerId: string, accountNo: string) {
  return new Set(
    [learnerId, accountNo].filter((v) => v && v !== "-").map((v) => String(v).trim())
  );
}

export function entryMatchesAccount(
  entry: BillingLedgerEntry,
  learnerId: string,
  accountNo: string
): boolean {
  const keys = accountKeys(learnerId, accountNo);
  return (
    keys.has(String(entry.learnerId || "").trim()) ||
    keys.has(String(entry.accountNo || "").trim())
  );
}

export function getAccountLedger(
  schoolId: string,
  learnerId: string,
  accountNo: string
): BillingLedgerEntry[] {
  return readSchoolLedger(schoolId)
    .filter((e) => entryMatchesAccount(e, learnerId, accountNo))
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    );
}

export function calculateAccountBalance(
  transactions: BillingLedgerEntry[],
  learnerId?: string,
  accountNo?: string
): number {
  const list =
    learnerId || accountNo
      ? transactions.filter((e) => entryMatchesAccount(e, learnerId || "", accountNo || ""))
      : transactions;

  const invoiceTotal = list
    .filter((e) => e.type === "invoice")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const paymentTotal = list
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const creditTotal = list
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);

  return invoiceTotal - paymentTotal - creditTotal;
}

export function getLastInvoice(transactions: BillingLedgerEntry[]) {
  return transactions
    .filter((e) => e.type === "invoice")
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )[0] || null;
}

export function getLastPayment(transactions: BillingLedgerEntry[]) {
  return transactions
    .filter((e) => e.type === "payment")
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )[0] || null;
}

function statusFromBalance(balance: number) {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

export function getBillingRows(learners: any[], schoolId: string): BillingAccountRow[] {
  const ledger = readSchoolLedger(schoolId);

  return (learners || []).map((learner: any) => {
    const learnerId = String(learner?.id || learner?.learnerId || "").trim();
    const accountNo = getLearnerAccountNo(learner);
    const accountLedger = getAccountLedger(schoolId, learnerId, accountNo);
    const balance = calculateAccountBalance(accountLedger);
    const invoiceTotal = accountLedger
      .filter((e) => e.type === "invoice")
      .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
    const paymentTotal = accountLedger
      .filter((e) => e.type === "payment")
      .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
    const creditTotal = accountLedger
      .filter((e) => e.type === "credit")
      .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
    const lastInv = getLastInvoice(accountLedger);
    const lastPay = getLastPayment(accountLedger);

    return {
      id: learnerId,
      learnerId,
      accountNo,
      name: learner?.firstName || learner?.name || "-",
      surname: learner?.lastName || learner?.surname || "-",
      balance,
      invoiceTotal,
      paymentTotal,
      creditTotal,
      lastInvoice: lastInv ? formatMoney(lastInv.amount) : "No invoices",
      lastInvoiceDate: lastInv?.date || "",
      lastPayment: lastPay
        ? `${formatMoney(lastPay.amount)} on ${lastPay.date || ""}`
        : "No payments",
      lastPaymentDate: lastPay?.date || "",
      status: statusFromBalance(balance),
    };
  });
}

export function appendPaymentTransaction(input: {
  schoolId: string;
  learnerId: string;
  accountNo: string;
  amount: number;
  date?: string;
  reference?: string;
  description?: string;
  method?: string;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const learnerId = String(input.learnerId || "").trim();
  const accountNo = String(input.accountNo || "").trim();
  const amount = normaliseBillingAmount(input.amount);
  if (!schoolId || !amount) return null;

  const entry: BillingLedgerEntry = {
    id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schoolId,
    learnerId,
    accountNo,
    type: "payment",
    amount,
    date: input.date || new Date().toISOString().slice(0, 10),
    reference: String(input.reference || "").trim(),
    description: String(input.description || "Payment").trim(),
    method: input.method,
    createdAt: new Date().toISOString(),
  };

  upsertSchoolEntries(schoolId, [entry]);
  return entry;
}

export function appendInvoiceRunTransactions(run: any, schoolId: string) {
  const sid = String(schoolId || run?.schoolId || "").trim();
  const rows = Array.isArray(run?.rows) ? run.rows : [];
  if (!sid || !rows.length) return [];

  const runId = String(run?.id || `run-${Date.now()}`);
  const invoiceDate =
    String(run?.invoiceDate || run?.date || "").trim() ||
    new Date().toISOString().slice(0, 10);

  const entries: BillingLedgerEntry[] = rows
    .map((row: any) => {
      const amount = normaliseBillingAmount(
        row?.invoiceAmount ?? row?.amount ?? row?.total ?? 0
      );
      if (!amount) return null;
      const learnerId = String(row?.id || row?.learnerId || "").trim();
      const accountNo = String(row?.accountNo || getLearnerAccountNo(row) || "").trim();
      return {
        id: `invoice-${runId}-${learnerId || accountNo}`,
        schoolId: sid,
        learnerId,
        accountNo,
        type: "invoice" as const,
        amount,
        date: invoiceDate,
        reference: String(row?.invoiceNo || row?.statementNo || runId).trim(),
        description: String(run?.description || `Invoice Run ${run?.month || ""}`).trim(),
        runId,
        createdAt: String(run?.createdAt || new Date().toISOString()),
      };
    })
    .filter(Boolean) as BillingLedgerEntry[];

  if (entries.length) upsertSchoolEntries(sid, entries);
  return entries;
}

export function mergeApiLedger(schoolId: string, entries: BillingLedgerEntry[]) {
  if (!schoolId || !entries.length) return;
  upsertSchoolEntries(schoolId, entries);
}

function migrateLegacyLedgerIfNeeded(schoolId: string) {
  const flag = `${MIGRATED_FLAG_PREFIX}${schoolId}`;
  if (localStorage.getItem(flag) === "1") return;

  const existing = readSchoolLedgerRaw(schoolId);
  const byId = new Map(existing.map((e) => [e.id, e]));

  const invoiceRuns = readJson<any[]>("educlearInvoiceRuns", []);
  for (const run of invoiceRuns) {
    const rows = Array.isArray(run?.rows) ? run.rows : [];
    const runId = String(run?.id || "");
    const invoiceDate =
      String(run?.invoiceDate || run?.date || "").trim() ||
      new Date().toISOString().slice(0, 10);
    for (const row of rows) {
      const amount = normaliseBillingAmount(
        row?.invoiceAmount ?? row?.amount ?? row?.total ?? 0
      );
      if (!amount) continue;
      const learnerId = String(row?.id || row?.learnerId || "").trim();
      const accountNo = String(row?.accountNo || getLearnerAccountNo(row) || "").trim();
      const id = `invoice-${runId}-${learnerId || accountNo}`;
      byId.set(id, {
        id,
        schoolId,
        learnerId,
        accountNo,
        type: "invoice",
        amount,
        date: invoiceDate,
        reference: String(row?.invoiceNo || row?.statementNo || runId).trim(),
        description: String(run?.description || "Invoice").trim(),
        runId,
        createdAt: String(run?.createdAt || new Date().toISOString()),
      });
    }
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) || "";
    if (!key.startsWith("savedPayments:")) continue;
    const accountKey = key.replace("savedPayments:", "");
    const payments = readJson<any[]>(key, []);
    for (const pay of payments) {
      const amount = normaliseBillingAmount(pay?.amount);
      if (!amount) continue;
      const createdAt = String(pay?.createdAt || new Date().toISOString());
      const id = String(pay?.id || `pay-legacy-${accountKey}-${createdAt}`);
      byId.set(id, {
        id,
        schoolId,
        learnerId: String(pay?.learnerId || accountKey).trim(),
        accountNo: String(pay?.accountNo || accountKey).trim(),
        type: "payment",
        amount,
        date: String(pay?.date || pay?.paymentDate || createdAt).slice(0, 10),
        reference: String(pay?.reference || pay?.type || "").trim(),
        description: String(pay?.description || "Payment").trim(),
        method: pay?.type || pay?.method,
        createdAt,
      });
    }
  }

  const key = String(schoolId || "").trim();
  const all = readAllLedgers();
  all[key] = Array.from(byId.values());
  writeAllLedgers(all);
  localStorage.setItem(flag, "1");
  notifyBillingUpdated();
}

export function ledgerEntryToApiShape(entry: BillingLedgerEntry) {
  return {
    id: entry.id,
    schoolId: entry.schoolId,
    learnerId: entry.learnerId,
    accountNo: entry.accountNo,
    type: entry.type,
    amount: entry.amount,
    date: entry.date,
    reference: entry.reference,
    description: entry.description,
    method: entry.method,
    runId: entry.runId,
    createdAt: entry.createdAt,
  };
}
