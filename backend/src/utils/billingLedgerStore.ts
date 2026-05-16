import fs from "fs";
import path from "path";

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
  const paymentTotal = matched
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  const creditTotal = matched
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + normaliseAmount(e.amount), 0);
  return invoiceTotal - paymentTotal - creditTotal;
}
