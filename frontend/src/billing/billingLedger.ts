import { getLearnerAccountNo } from "../learner/learnerIdentity";
import {
  filterKidESysBillingRows,
  isKidESysAccountRef,
  normalizeKidESysAccountRef,
  resolveKidESysAccountRefFromLearner,
} from "./billingAccountRef";
import {
  buildKidesysHistoryAccountIndex,
  readSchoolKidesysHistory,
  readStatementApiAccounts,
  readStatementApiSummary,
  type KidesysHistoryEntry,
  type StatementApiSummary,
} from "./kidesysTransactionHistory";

export {
  filterKidESysBillingRows,
  isKidESysAccountRef,
  isSasamsNumericBillingAccount,
  normalizeKidESysAccountRef,
  resolveKidESysAccountRefFromLearner,
  resolveKidESysAccountRefFromRow,
} from "./billingAccountRef";
import {
  formatLedgerDescriptionDisplay,
  formatLedgerReferenceDisplay,
  formatLedgerTypeLabel,
  isKidesysOpeningBalanceEntry,
  isMigratedOpeningBalanceOverviewLabel,
  MIGRATED_OPENING_BALANCE_OVERVIEW,
} from "./billingDisplayRules";

export { isKidesysOpeningBalanceEntry } from "./billingDisplayRules";
import type { BillingSettingsState } from "../billingSettings/types/billingSettings";
import {
  buildInvoiceReference,
  computeInvoiceDueDate,
  resolveInvoiceMessage,
} from "./billingSettingsEngine";

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
  bankTransactionId?: string;
  bankImportId?: string;
  source?: string;
  createdAt: string;
};

export type BillingAccountRow = {
  id: string;
  learnerId: string;
  accountNo: string;
  familyAccountId?: string;
  name: string;
  surname: string;
  balance: number;
  invoiceTotal: number;
  penaltyTotal: number;
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
/** Canonical JSON ledger bucket when live school id differs (Da Silva). */
const CANONICAL_BILLING_LEDGER_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

function resolveLedgerStorageKey(schoolId: string): string {
  const key = String(schoolId || "").trim();
  if (!key) return key;
  const all = readAllLedgers();
  if (Array.isArray(all[key]) && all[key].length > 0) return key;
  const canonical = CANONICAL_BILLING_LEDGER_SCHOOL_ID;
  if (
    key !== canonical &&
    Array.isArray(all[canonical]) &&
    all[canonical].length > 0
  ) {
    return canonical;
  }
  return key;
}

export const BILLING_UPDATED_EVENT = "educlear-billing-updated";
export const LEARNERS_REFRESH_EVENT = "educlear-learners-refresh";

export function notifyBillingUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BILLING_UPDATED_EVENT));
  }
}

export function notifyLearnersRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LEARNERS_REFRESH_EVENT));
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
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Migrated schools can hit localStorage quotas due to large ledgers.
    // Writes are best-effort: the UI still works from API + in-memory state.
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[BillingLedger] localStorage write failed for ${key}`, error);
    }
  }
}

function readAllLedgers(): Record<string, BillingLedgerEntry[]> {
  const data = readJson<Record<string, BillingLedgerEntry[]>>(LEDGER_STORAGE_KEY, {});
  return data && typeof data === "object" ? data : {};
}

function writeAllLedgers(data: Record<string, BillingLedgerEntry[]>) {
  writeJson(LEDGER_STORAGE_KEY, data);
}

function readSchoolLedgerRaw(schoolId: string): BillingLedgerEntry[] {
  const storeKey = resolveLedgerStorageKey(schoolId);
  if (!storeKey) return [];
  const all = readAllLedgers();
  return Array.isArray(all[storeKey]) ? all[storeKey] : [];
}

export function readSchoolLedger(schoolId: string): BillingLedgerEntry[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  migrateLegacyLedgerIfNeeded(resolveLedgerStorageKey(key));
  return readSchoolLedgerRaw(key);
}

export function writeSchoolLedger(schoolId: string, entries: BillingLedgerEntry[]) {
  const storeKey = resolveLedgerStorageKey(schoolId);
  if (!storeKey) return;
  const all = readAllLedgers();
  all[storeKey] = entries;
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
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const penaltyTotal = entries
    .filter((e) => e.type === "penalty")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const paymentTotal = entries
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const creditTotal = entries
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  return invoiceTotal + penaltyTotal - paymentTotal - creditTotal;
}

export function resolveEntryLearnerLabel(
  entry: BillingLedgerEntry,
  nameByLearnerId: Map<string, string>,
  accountRef = ""
): string {
  const learnerId = String(entry.learnerId || "").trim();
  const ref = String(accountRef || "").trim();
  if (learnerId && nameByLearnerId.has(learnerId)) {
    return nameByLearnerId.get(learnerId) || "";
  }
  if (
    entry.type === "payment" &&
    (!learnerId || (ref && learnerId === ref))
  ) {
    return "Family account";
  }
  return "";
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
  const penaltyTotal = list
    .filter((e) => e.type === "penalty")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const paymentTotal = list
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const creditTotal = list
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);

  return invoiceTotal + penaltyTotal - paymentTotal - creditTotal;
}

export function getLastInvoice(transactions: BillingLedgerEntry[]) {
  return transactions
    .filter((e) => e.type === "invoice" && !isKidesysOpeningBalanceEntry(e))
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )[0] || null;
}

function resolveLastInvoiceDisplay(
  accountLedger: BillingLedgerEntry[],
  historySummary?: { lastInvoice: KidesysHistoryEntry | null }
): {
  lastInvoice: string;
  lastInvoiceDate: string;
} {
  const histInv = historySummary?.lastInvoice;
  if (histInv) {
    return {
      lastInvoice: formatMoney(histInv.amount),
      lastInvoiceDate: histInv.date || "",
    };
  }
  const lastInv = getLastInvoice(accountLedger);
  if (lastInv) {
    return {
      lastInvoice: formatMoney(lastInv.amount),
      lastInvoiceDate: lastInv.date || "",
    };
  }
  const hasOpeningBalance = accountLedger.some(
    (e) => e.type === "invoice" && isKidesysOpeningBalanceEntry(e)
  );
  if (hasOpeningBalance) {
    return { lastInvoice: MIGRATED_OPENING_BALANCE_OVERVIEW, lastInvoiceDate: "" };
  }
  return { lastInvoice: "No invoices", lastInvoiceDate: "" };
}

function resolveLastPaymentDisplay(
  accountLedger: BillingLedgerEntry[],
  historySummary?: { lastPayment: KidesysHistoryEntry | null }
): { lastPayment: string; lastPaymentDate: string } {
  const histPay = historySummary?.lastPayment;
  if (histPay) {
    return {
      lastPayment: `${formatMoney(histPay.amount)} on ${histPay.date || ""}`,
      lastPaymentDate: histPay.date || "",
    };
  }
  const lastPay = getLastPayment(accountLedger);
  return {
    lastPayment: lastPay
      ? `${formatMoney(lastPay.amount)} on ${lastPay.date || ""}`
      : "No payments",
    lastPaymentDate: lastPay?.date || "",
  };
}

function apiSummaryHasLastInvoice(apiSummary: StatementApiSummary | null): boolean {
  if (!apiSummary) return false;
  if (Number(apiSummary.lastInvoice) > 0) return true;
  return Boolean(String(apiSummary.lastInvoiceDate || "").trim());
}

function apiSummaryHasLastPayment(apiSummary: StatementApiSummary | null): boolean {
  if (!apiSummary) return false;
  if (Number(apiSummary.lastPayment) > 0) return true;
  return Boolean(String(apiSummary.lastPaymentDate || "").trim());
}

/** Last invoice for overview tables — Kid-e-Sys history first, then API, then ledger. */
function resolveLastInvoiceForRow(
  accountLedger: BillingLedgerEntry[],
  historySummary: { lastInvoice: KidesysHistoryEntry | null },
  apiSummary: StatementApiSummary | null
): { lastInvoice: string; lastInvoiceDate: string } {
  const histInv = historySummary.lastInvoice;
  if (histInv) {
    return {
      lastInvoice: formatMoney(histInv.amount),
      lastInvoiceDate: histInv.date || "",
    };
  }
  if (apiSummary?.lastInvoiceLabel && isMigratedOpeningBalanceOverviewLabel(apiSummary.lastInvoiceLabel)) {
    return {
      lastInvoice: MIGRATED_OPENING_BALANCE_OVERVIEW,
      lastInvoiceDate: "",
    };
  }
  if (apiSummaryHasLastInvoice(apiSummary)) {
    return {
      lastInvoice: formatMoney(apiSummary!.lastInvoice),
      lastInvoiceDate: apiSummary!.lastInvoiceDate || "",
    };
  }
  return resolveLastInvoiceDisplay(accountLedger, historySummary);
}

/** Last payment for overview tables — Kid-e-Sys history first, then API, then ledger. */
function resolveLastPaymentForRow(
  accountLedger: BillingLedgerEntry[],
  historySummary: { lastPayment: KidesysHistoryEntry | null },
  apiSummary: StatementApiSummary | null
): { lastPayment: string; lastPaymentDate: string } {
  const histPay = historySummary.lastPayment;
  if (histPay) {
    const date = histPay.date || "";
    return {
      lastPayment: date ? `${formatMoney(histPay.amount)} on ${date}` : formatMoney(histPay.amount),
      lastPaymentDate: date,
    };
  }
  if (apiSummaryHasLastPayment(apiSummary)) {
    const date = apiSummary!.lastPaymentDate || "";
    return {
      lastPayment: date
        ? `${formatMoney(apiSummary!.lastPayment)} on ${date}`
        : formatMoney(apiSummary!.lastPayment),
      lastPaymentDate: date,
    };
  }
  return resolveLastPaymentDisplay(accountLedger, historySummary);
}

export function getLastPayment(transactions: BillingLedgerEntry[]) {
  return transactions
    .filter((e) => e.type === "payment")
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )[0] || null;
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
  const matched = entries.filter((e) => entryMatchesAccount(e, learnerId, accountNo));
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
    .reduce((sum, e) => sum + normaliseBillingAmount(e.amount), 0);

  const lines: OpenInvoiceLine[] = [];
  for (const entry of debits) {
    const gross = normaliseBillingAmount(entry.amount);
    if (gross <= 0) continue;
    const applied = Math.min(gross, creditPool);
    creditPool -= applied;
    const unpaid = gross - applied;
    if (unpaid <= 0.001) continue;
    const typeLabel = formatLedgerTypeLabel(entry);
    const reference = formatLedgerReferenceDisplay(entry);
    const description = formatLedgerDescriptionDisplay(entry);
    lines.push({
      id: entry.id,
      audit: entry.id,
      type: typeLabel,
      date: entry.date || "",
      reference: reference !== "—" ? reference : typeLabel,
      description: description !== "—" ? description : typeLabel,
      unpaid,
      amount: gross,
    });
  }
  return lines;
}

function statusFromBalance(balance: number) {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

function apiRowHasLastInvoice(row: any): boolean {
  const amount = Number(row?.lastInvoice);
  if (Number.isFinite(amount) && amount > 0) return true;
  return Boolean(String(row?.lastInvoiceDate || "").trim());
}

function apiRowHasLastPayment(row: any): boolean {
  const amount = Number(row?.lastPayment);
  if (Number.isFinite(amount) && amount > 0) return true;
  return Boolean(String(row?.lastPaymentDate || "").trim());
}

/** Map GET /api/statements row → billing table row (Kid-e-Sys accountRef + migrated fields). */
export function mapApiStatementRowToBillingAccountRow(row: any): BillingAccountRow {
  const accountNo = normalizeKidESysAccountRef(row?.accountNo) || "-";
  const learnerId = String(row?.learnerId || "").trim();
  const familyAccountId = row?.familyAccountId
    ? String(row.familyAccountId).trim()
    : undefined;
  const balance = Number.isFinite(Number(row?.balance)) ? Number(row.balance) : 0;
  const lastInvoiceDate = String(row?.lastInvoiceDate || "");
  const lastPaymentDate = String(row?.lastPaymentDate || "");
  const lastInvoiceAmount = Number(row?.lastInvoice);
  const lastPaymentAmount = Number(row?.lastPayment);

  let lastInvoice: string;
  if (
    row?.lastInvoiceLabel &&
    isMigratedOpeningBalanceOverviewLabel(String(row.lastInvoiceLabel))
  ) {
    lastInvoice = MIGRATED_OPENING_BALANCE_OVERVIEW;
  } else if (apiRowHasLastInvoice(row)) {
    lastInvoice = formatMoney(
      Number.isFinite(lastInvoiceAmount) ? lastInvoiceAmount : 0
    );
  } else {
    lastInvoice = "No invoices";
  }

  let lastPayment: string;
  if (apiRowHasLastPayment(row)) {
    const payLabel = formatMoney(
      Number.isFinite(lastPaymentAmount) ? lastPaymentAmount : 0
    );
    lastPayment = lastPaymentDate ? `${payLabel} on ${lastPaymentDate}` : payLabel;
  } else {
    lastPayment = "No payments";
  }

  const status = String(row?.status || "").trim() || statusFromBalance(balance);

  return {
    id: familyAccountId || learnerId || accountNo,
    learnerId,
    accountNo,
    familyAccountId,
    name: String(row?.name || row?.firstName || "").trim() || "-",
    surname: String(row?.surname || row?.lastName || "").trim() || "-",
    balance,
    invoiceTotal: 0,
    penaltyTotal: 0,
    paymentTotal: 0,
    creditTotal: 0,
    lastInvoice,
    lastInvoiceDate,
    lastPayment,
    lastPaymentDate,
    status,
  };
}

function resolveBillingGroupKey(learner: any): string {
  const familyAccountId = String(
    learner?.familyAccountId || learner?.familyAccount?.id || ""
  ).trim();
  if (familyAccountId) return `family:${familyAccountId}`;
  const accountNo = getLearnerAccountNo(learner);
  if (accountNo && accountNo !== "-") return `account:${accountNo}`;
  const learnerId = String(learner?.id || learner?.learnerId || "").trim();
  return learnerId ? `learner:${learnerId}` : "learner:unknown";
}

function buildBillingAccountRow(
  anchor: any,
  memberIds: string[],
  schoolId: string,
  ledger: BillingLedgerEntry[],
  historyIndex: Map<string, { lastInvoice: KidesysHistoryEntry | null; lastPayment: KidesysHistoryEntry | null }>
): BillingAccountRow {
  const learnerId = String(anchor?.id || anchor?.learnerId || "").trim();
  const accountNo = getLearnerAccountNo(anchor);
  const familyAccountId = String(
    anchor?.familyAccountId || anchor?.familyAccount?.id || ""
  ).trim() || undefined;
  const accountLedger =
    familyAccountId || memberIds.length > 1
      ? collectFamilyAccountEntries(ledger, { accountRef: accountNo, learnerIds: memberIds })
      : getAccountLedger(schoolId, learnerId, accountNo);
  const balance = calculateBalanceFromEntries(accountLedger);
  const invoiceTotal = accountLedger
    .filter((e) => e.type === "invoice")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const penaltyTotal = accountLedger
    .filter((e) => e.type === "penalty")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const paymentTotal = accountLedger
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const creditTotal = accountLedger
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const apiSummary = readStatementApiSummary(schoolId, accountNo);
  const historySummary = historyIndex.get(accountNo) || {
    lastInvoice: null,
    lastPayment: null,
  };
  const { lastInvoice, lastInvoiceDate } = resolveLastInvoiceForRow(
    accountLedger,
    historySummary,
    apiSummary
  );
  const { lastPayment, lastPaymentDate } = resolveLastPaymentForRow(
    accountLedger,
    historySummary,
    apiSummary
  );

  return {
    id: familyAccountId || learnerId,
    learnerId,
    accountNo,
    familyAccountId,
    name: anchor?.firstName || anchor?.name || "-",
    surname: anchor?.lastName || anchor?.surname || "-",
    balance,
    invoiceTotal,
    penaltyTotal,
    paymentTotal,
    creditTotal,
    lastInvoice,
    lastInvoiceDate,
    lastPayment,
    lastPaymentDate,
    status: statusFromBalance(balance),
  };
}

function buildLearnerBillingDisplayIndex(learners: any[]) {
  const byAccountRef = new Map<string, any>();
  const byFamilyId = new Map<string, any>();
  const byLearnerId = new Map<string, any>();

  for (const learner of learners || []) {
    const learnerId = String(learner?.id || learner?.learnerId || "").trim();
    if (learnerId) byLearnerId.set(learnerId, learner);

    const familyAccountId = String(
      learner?.familyAccountId || learner?.familyAccount?.id || ""
    ).trim();
    if (familyAccountId && !byFamilyId.has(familyAccountId)) {
      byFamilyId.set(familyAccountId, learner);
    }

    const accountRef = resolveKidESysAccountRefFromLearner(learner);
    if (accountRef && !byAccountRef.has(accountRef)) {
      byAccountRef.set(accountRef, learner);
    }
  }

  return { byAccountRef, byFamilyId, byLearnerId };
}

function enrichBillingRowDisplay(
  row: BillingAccountRow,
  index: ReturnType<typeof buildLearnerBillingDisplayIndex>
): BillingAccountRow {
  const accountRef = normalizeKidESysAccountRef(row.accountNo);
  const anchor =
    (accountRef ? index.byAccountRef.get(accountRef) : null) ||
    (row.familyAccountId ? index.byFamilyId.get(String(row.familyAccountId)) : null) ||
    (row.learnerId ? index.byLearnerId.get(String(row.learnerId)) : null);

  if (!anchor) return row;

  const displayName = String(anchor?.firstName || anchor?.name || "").trim();
  const displaySurname = String(anchor?.lastName || anchor?.surname || "").trim();

  return {
    ...row,
    name: displayName || (row.name !== "-" ? row.name : "-"),
    surname: displaySurname || (row.surname !== "-" ? row.surname : "-"),
  };
}

/**
 * Billing account list for UI tables — GET /api/statements (Age Analysis accountRef) only.
 * Balances/invoice history stay on API rows; learner list enriches name/surname display only.
 */
export function getBillingRows(learners: any[], schoolId: string): BillingAccountRow[] {
  const apiCached = readStatementApiAccounts(schoolId);
  if (!apiCached.length) return [];

  const index = buildLearnerBillingDisplayIndex(learners);

  return filterKidESysBillingRows(
    apiCached.map((row) =>
      enrichBillingRowDisplay(mapApiStatementRowToBillingAccountRow(row), index)
    )
  ).sort((a, b) => String(a.accountNo).localeCompare(String(b.accountNo)));
}

export function appendInvoiceTransaction(input: {
  schoolId: string;
  learnerId: string;
  accountNo: string;
  amount: number;
  date?: string;
  dueDate?: string;
  reference?: string;
  description?: string;
  runId?: string;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const learnerId = String(input.learnerId || "").trim();
  const accountNo = String(input.accountNo || "").trim();
  const amount = normaliseBillingAmount(input.amount);
  if (!schoolId || !amount) return null;

  const invoiceDate = input.date || new Date().toISOString().slice(0, 10);
  const entry: BillingLedgerEntry = {
    id: `invoice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schoolId,
    learnerId,
    accountNo,
    type: "invoice",
    amount,
    date: invoiceDate,
    dueDate: input.dueDate || invoiceDate,
    reference: String(input.reference || "").trim(),
    description: String(input.description || "Invoice").trim(),
    runId: input.runId,
    createdAt: new Date().toISOString(),
  };

  upsertSchoolEntries(schoolId, [entry]);
  return entry;
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

export function appendPenaltyTransaction(input: {
  schoolId: string;
  learnerId: string;
  accountNo: string;
  amount: number;
  date?: string;
  dueDate?: string;
  reference?: string;
  description?: string;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const learnerId = String(input.learnerId || "").trim();
  const accountNo = String(input.accountNo || "").trim();
  const amount = normaliseBillingAmount(input.amount);
  const date = input.date || new Date().toISOString().slice(0, 10);
  const description = String(input.description || "Late payment penalty").trim();
  if (!schoolId || !amount || !accountNo || accountNo === "-") return null;

  const id = buildPenaltyEntryId(schoolId, accountNo, date, description);
  const existing = readSchoolLedger(schoolId).find((e) => e.id === id);
  if (existing) return existing;

  const entry: BillingLedgerEntry = {
    id,
    schoolId,
    learnerId,
    accountNo,
    type: "penalty",
    amount,
    date,
    dueDate: input.dueDate || date,
    reference: String(input.reference || `PEN-${date}`).trim(),
    description,
    createdAt: new Date().toISOString(),
  };

  upsertSchoolEntries(schoolId, [entry]);
  return entry;
}

export function appendInvoiceRunTransactions(
  run: any,
  schoolId: string,
  settings?: BillingSettingsState
) {
  const sid = String(schoolId || run?.schoolId || "").trim();
  const rows = Array.isArray(run?.rows) ? run.rows : [];
  if (!sid || !rows.length) return [];

  const runId = String(run?.id || `run-${Date.now()}`);
  const invoiceDate =
    String(run?.invoiceDate || run?.date || "").trim() ||
    new Date().toISOString().slice(0, 10);
  const runDueDate = settings
    ? computeInvoiceDueDate(
        invoiceDate,
        settings,
        String(run?.dueDate || "").trim() || undefined
      )
    : String(run?.dueDate || "").trim() || invoiceDate;
  const runDescription =
    String(run?.description || run?.invoiceMessage || "").trim() ||
    (settings ? resolveInvoiceMessage(settings) : "") ||
    `Invoice Run ${run?.month || ""}`;

  const entries: BillingLedgerEntry[] = rows
    .map((row: any, index: number) => {
      const amount = normaliseBillingAmount(
        row?.invoiceAmount ?? row?.amount ?? row?.total ?? 0
      );
      if (!amount) return null;
      const learnerId = String(row?.id || row?.learnerId || "").trim();
      const accountNo = String(row?.accountNo || getLearnerAccountNo(row) || "").trim();
      const rowDueDate = settings
        ? computeInvoiceDueDate(
            invoiceDate,
            settings,
            String(row?.dueDate || runDueDate || "").trim() || undefined
          )
        : String(row?.dueDate || runDueDate || "").trim() || invoiceDate;
      const fallbackRef = String(row?.invoiceNo || row?.statementNo || runId).trim();
      const reference = settings
        ? buildInvoiceReference(settings, invoiceDate, index + 1, fallbackRef)
        : fallbackRef;
      return {
        id: `invoice-${runId}-${learnerId || accountNo}`,
        schoolId: sid,
        learnerId,
        accountNo,
        type: "invoice" as const,
        amount,
        date: invoiceDate,
        dueDate: rowDueDate,
        reference,
        description: runDescription,
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
    const runDueDate = String(run?.dueDate || "").trim() || invoiceDate;
    for (const row of rows) {
      const amount = normaliseBillingAmount(
        row?.invoiceAmount ?? row?.amount ?? row?.total ?? 0
      );
      if (!amount) continue;
      const learnerId = String(row?.id || row?.learnerId || "").trim();
      const accountNo = String(row?.accountNo || getLearnerAccountNo(row) || "").trim();
      const rowDueDate = String(row?.dueDate || runDueDate || "").trim() || invoiceDate;
      const id = `invoice-${runId}-${learnerId || accountNo}`;
      byId.set(id, {
        id,
        schoolId,
        learnerId,
        accountNo,
        type: "invoice",
        amount,
        date: invoiceDate,
        dueDate: rowDueDate,
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

  const storeKey = resolveLedgerStorageKey(String(schoolId || "").trim());
  const all = readAllLedgers();
  all[storeKey] = Array.from(byId.values());
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
    dueDate: entry.dueDate,
    reference: entry.reference,
    description: entry.description,
    method: entry.method,
    runId: entry.runId,
    createdAt: entry.createdAt,
  };
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

/** Normalise to YYYY-MM-DD (ISO, DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD). */
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

export function buildRunDueDateMap(): Record<string, string> {
  const runs = readJson<any[]>("educlearInvoiceRuns", []);
  const map: Record<string, string> = {};
  if (!Array.isArray(runs)) return map;
  for (const run of runs) {
    const id = String(run?.id || "").trim();
    const due = normaliseIsoDate(run?.dueDate);
    if (id && due) map[id] = due;
  }
  return map;
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

/** Due date strictly before as-of date (due today is not overdue). */
export function isInvoicePastDue(dueIso: string, asOfDate: string): boolean {
  const due = normaliseIsoDate(dueIso);
  const asOf = normaliseIsoDate(asOfDate);
  if (!due || !asOf) return false;
  return due < asOf;
}

export type LegalEligibleDebug = {
  statementRowsCount: number;
  balancePositiveCount: number;
  pastDueInvoiceCount: number;
  legalEligibleCount: number;
  excluded: { accountNo: string; learnerId: string; reason: string }[];
};

export type LegalEligibleCandidate = {
  learnerId: string;
  accountNo: string;
  learnerName: string;
  grade: string;
  className: string;
  balance: number;
  overdueBalance: number;
  overdueInvoiceDates: string[];
  status: string;
};

function matchesLegalStatusFilter(status: string, filter: string) {
  if (!filter || filter === "All Overdue") {
    return status === "Recently Owing" || status === "Bad Debt";
  }
  return status === filter;
}

function computeOverdueFromLedger(
  schoolId: string,
  learnerId: string,
  accountNo: string,
  balance: number,
  asOfDate: string,
  runDueDates: Record<string, string>
) {
  const accountLedger = getAccountLedger(schoolId, learnerId, accountNo);
  const asOf = normaliseIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);

  let overdueAmount = 0;
  const overdueDates: string[] = [];

  for (const entry of accountLedger.filter((e) => e.type === "invoice")) {
    const amount = normaliseBillingAmount(entry.amount);
    if (!amount) continue;
    const due = resolveEntryDueDate(entry, runDueDates);
    if (!due || !isInvoicePastDue(due, asOf)) continue;
    overdueAmount += amount;
    if (!overdueDates.includes(due)) overdueDates.push(due);
  }

  overdueDates.sort();

  if (overdueAmount > 0 && balance > 0) {
    return {
      overdueBalance: Math.min(balance, overdueAmount),
      overdueInvoiceDates: overdueDates,
    };
  }

  // Statements shows owing but ledger rows may lack dueDate — use latest invoice due from run/row
  if (balance > 0) {
    let latestDue = "";
    for (const entry of accountLedger.filter((e) => e.type === "invoice")) {
      const due = resolveEntryDueDate(entry, runDueDates);
      if (due && (!latestDue || due > latestDue)) latestDue = due;
    }
    if (latestDue && isInvoicePastDue(latestDue, asOf)) {
      return {
        overdueBalance: balance,
        overdueInvoiceDates: [latestDue, ...overdueDates.filter((d) => d !== latestDue)].sort(),
      };
    }
  }

  return { overdueBalance: 0, overdueInvoiceDates: [] };
}

/**
 * Legal eligibility uses the same statement rows + unified ledger as Statements.
 */
export function computeLegalEligibleFromStatements(
  statementRows: BillingAccountRow[],
  schoolId: string,
  learners: any[],
  options: {
    statusFilter?: string;
    minBalance?: number;
    gradeFilter?: string;
    classFilter?: string;
    asOfDate?: string;
  } = {}
): { eligible: LegalEligibleCandidate[]; debug: LegalEligibleDebug } {
  const statusFilter = options.statusFilter || "All Overdue";
  const minBalance = normaliseBillingAmount(options.minBalance ?? 0);
  const gradeFilter = String(options.gradeFilter || "").trim();
  const classFilter = String(options.classFilter || "").trim();
  const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
  const runDueDates = buildRunDueDateMap();

  const learnerById = new Map<string, any>();
  for (const learner of learners || []) {
    const id = String(learner?.id || learner?.learnerId || "").trim();
    if (id) learnerById.set(id, learner);
  }

  const debug: LegalEligibleDebug = {
    statementRowsCount: statementRows.length,
    balancePositiveCount: 0,
    pastDueInvoiceCount: 0,
    legalEligibleCount: 0,
    excluded: [],
  };

  const eligible: LegalEligibleCandidate[] = [];

  for (const row of statementRows) {
    const learnerId = String(row.learnerId || row.id || "").trim();
    const accountNo = String(row.accountNo || "").trim();
    const balance = normaliseBillingAmount(row.balance);
    const status = String(row.status || "Up To Date");

    if (!accountNo || accountNo === "-") {
      debug.excluded.push({ accountNo: accountNo || "-", learnerId, reason: "Unassigned account number" });
      continue;
    }

    if (balance <= 0) {
      debug.excluded.push({
        accountNo,
        learnerId,
        reason: balance < 0 ? "Overpaid account" : "Paid up account",
      });
      continue;
    }

    debug.balancePositiveCount += 1;

    if (!matchesLegalStatusFilter(status, statusFilter)) {
      debug.excluded.push({ accountNo, learnerId, reason: `Status filter (${status})` });
      continue;
    }

    const learner = learnerById.get(learnerId);
    const grade = String(learner?.grade || "").trim();
    const className = String(learner?.className || learner?.classroom || "").trim();
    if (gradeFilter && grade !== gradeFilter) {
      debug.excluded.push({ accountNo, learnerId, reason: "Grade filter" });
      continue;
    }
    if (classFilter && className !== classFilter) {
      debug.excluded.push({ accountNo, learnerId, reason: "Classroom filter" });
      continue;
    }

    const { overdueBalance, overdueInvoiceDates } = computeOverdueFromLedger(
      schoolId,
      learnerId,
      accountNo,
      balance,
      asOfDate,
      runDueDates
    );

    if (overdueInvoiceDates.length) debug.pastDueInvoiceCount += 1;

    if (overdueBalance <= 0) {
      debug.excluded.push({
        accountNo,
        learnerId,
        reason: "No invoice/fee rows with due date before today",
      });
      continue;
    }

    if (overdueBalance < minBalance) {
      debug.excluded.push({ accountNo, learnerId, reason: "Below minimum overdue balance" });
      continue;
    }

    eligible.push({
      learnerId,
      accountNo,
      learnerName: `${row.name || ""} ${row.surname || ""}`.trim(),
      grade,
      className,
      balance,
      overdueBalance,
      overdueInvoiceDates,
      status,
    });
  }

  debug.legalEligibleCount = eligible.length;

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[LegalBilling] eligibility", debug);
  }

  return { eligible, debug };
}
