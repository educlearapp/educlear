import {
  normalizeKidESysAccountRef,
  resolveKidESysAccountRefFromLearner,
  resolveKidESysAccountRefFromRow,
} from "./billingAccountRef";

export type PaymentAccountContext = {
  id: string;
  learnerId: string;
  accountNo: string;
  name: string;
  surname: string;
  balance: number;
  parentName?: string;
  lastPayment?: string;
  lastPaymentDate?: string;
  lastInvoice?: string;
  status?: string;
  familyAccountId?: string;
};

export type PaymentFormState = {
  accountNo: string;
  learnerId: string;
  date: string;
  type: string;
  description: string;
  amount: string;
  message: string;
};

export const PAYMENT_TYPES = [
  "EFT",
  "Cash",
  "Card",
  "Bank Transfer",
  "Debit Order",
  "Other",
] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_ACCOUNT_STORAGE_KEY = "selectedPaymentAccount";

function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Value safe for `<input type="date">` (yyyy-MM-dd or empty). */
export function dateInputValue(value: string | undefined | null): string {
  const raw = String(value ?? "").trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return "";
}

/** Stable yyyy-MM-dd for API payloads (never timezone-shifted). */
export function normalizeIsoDate(value: string | undefined | null): string {
  const fromInput = dateInputValue(value);
  if (fromInput) return fromInput;
  return todayIsoDate();
}

export function normalizePaymentType(value: string | undefined | null): PaymentType {
  const v = String(value ?? "").trim();
  return (PAYMENT_TYPES as readonly string[]).includes(v) ? (v as PaymentType) : "EFT";
}

export function defaultPaymentForm(account?: {
  learnerId?: string;
  accountNo?: string;
}): PaymentFormState {
  return {
    accountNo: String(account?.accountNo || "").trim(),
    learnerId: String(account?.learnerId || "").trim(),
    date: todayIsoDate(),
    type: "EFT",
    description: "",
    amount: "",
    message: "",
  };
}

export function parseAmountInput(raw: string): number {
  const n = Number(String(raw || "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function readStoredPaymentAccount(): any | null {
  try {
    const raw = localStorage.getItem(PAYMENT_ACCOUNT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function persistPaymentAccount(account: PaymentAccountContext) {
  const learnerId = String(account.learnerId || "").trim();
  const payload = {
    ...account,
    learnerId,
    id: learnerId,
    accountNo: account.accountNo,
  };
  localStorage.setItem(PAYMENT_ACCOUNT_STORAGE_KEY, JSON.stringify(payload));
}

/** True when two payment account snapshots match (avoids redundant setState). */
export function paymentAccountContextsEqual(
  a: PaymentAccountContext | null | undefined,
  b: PaymentAccountContext | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const norm = (v: unknown) => String(v ?? "").trim();
  const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
  return (
    norm(a.learnerId) === norm(b.learnerId) &&
    norm(a.accountNo) === norm(b.accountNo) &&
    norm(a.name) === norm(b.name) &&
    norm(a.surname) === norm(b.surname) &&
    money(a.balance) === money(b.balance) &&
    norm(a.parentName) === norm(b.parentName) &&
    norm(a.lastPayment) === norm(b.lastPayment) &&
    norm(a.lastPaymentDate) === norm(b.lastPaymentDate) &&
    norm(a.lastInvoice) === norm(b.lastInvoice) &&
    norm(a.status) === norm(b.status) &&
    norm(a.familyAccountId) === norm(b.familyAccountId)
  );
}

function resolveAccountNo(source: any): string {
  return (
    resolveKidESysAccountRefFromRow(source) ||
    resolveKidESysAccountRefFromLearner(source)
  );
}

function findLearnerForRow(row: any, learners: any[]): any | null {
  const list = Array.isArray(learners) ? learners : [];
  if (!list.length || !row) return null;

  const rowLearnerId = String(row?.learnerId || "").trim();
  const rowId = String(row?.id || "").trim();
  const accountNo = resolveAccountNo(row);

  const byLearnerKey = (key: string) =>
    key
      ? list.find((l) => String(l?.id || l?.learnerId || "").trim() === key)
      : undefined;

  if (rowLearnerId) {
    const match = byLearnerKey(rowLearnerId);
    if (match) return match;
  }
  if (rowId) {
    const match = byLearnerKey(rowId);
    if (match) return match;
  }
  if (accountNo) {
    const upper = accountNo.toUpperCase();
    const match = list.find(
      (l) =>
        String(l?.familyAccount?.accountRef || "")
          .trim()
          .toUpperCase() === upper
    );
    if (match) return match;
  }
  return null;
}

/** Real learner UUID from the learners list — never account row id or accountNo. */
export function resolveRealLearnerId(source: any, learners?: any[]): string {
  const learner = findLearnerForRow(source, learners || []);
  if (learner) {
    return String(learner.id || learner.learnerId || "").trim();
  }
  return String(source?.learnerId || "").trim();
}

function resolveLearnerId(source: any, learners?: any[]): string {
  return resolveRealLearnerId(source, learners);
}

function rowMatchesAccount(
  row: any,
  learnerId: string,
  accountNo: string,
  learners?: any[]
): boolean {
  const rowLearnerId = resolveLearnerId(row, learners);
  const rowAccountNo = resolveAccountNo(row);
  if (learnerId && rowLearnerId && rowLearnerId === learnerId) return true;
  if (accountNo && rowAccountNo && rowAccountNo === accountNo) return true;
  return false;
}

export function normalizePaymentAccount(
  raw: any,
  statementRows: any[],
  learners?: any[]
): PaymentAccountContext | null {
  if (!raw) return null;
  const learnerId = resolveLearnerId(raw, learners);
  const accountNo = resolveAccountNo(raw);
  if (!learnerId && !accountNo) return null;

  const live =
    statementRows.find((row) => rowMatchesAccount(row, learnerId, accountNo, learners)) || raw;

  const resolvedLearnerId = resolveLearnerId(live, learners) || learnerId;
  const resolvedAccountNo = resolveAccountNo(live) || accountNo;
  if (!resolvedLearnerId && !resolvedAccountNo) return null;

  const name = String(live?.name || live?.firstName || raw?.name || raw?.firstName || "").trim();
  const surname = String(
    live?.surname || live?.lastName || raw?.surname || raw?.lastName || ""
  ).trim();

  return {
    id: resolvedLearnerId,
    learnerId: resolvedLearnerId,
    accountNo: resolvedAccountNo,
    name: name || "-",
    surname: surname || "-",
    balance: Number(live?.balance ?? raw?.balance ?? 0),
    parentName: String(live?.parentName || raw?.parentName || "").trim() || undefined,
    lastPayment: live?.lastPayment || raw?.lastPayment,
    lastPaymentDate: live?.lastPaymentDate || raw?.lastPaymentDate,
    lastInvoice: live?.lastInvoice || raw?.lastInvoice,
    status: live?.status || raw?.status,
    familyAccountId: String(live?.familyAccountId || raw?.familyAccountId || "").trim() || undefined,
  };
}

export function accountsFromStatementRows(
  statementRows: any[],
  learners?: any[]
): PaymentAccountContext[] {
  const seen = new Set<string>();
  const list: PaymentAccountContext[] = [];
  for (const row of statementRows) {
    const learner = findLearnerForRow(row, learners || []);
    const realLearnerId = String(
      learner?.id || learner?.learnerId || row?.learnerId || ""
    ).trim();
    const normalized = normalizePaymentAccount(row, statementRows, learners);
    if (!normalized) continue;
    const accountNoKey = normalizeKidESysAccountRef(normalized.accountNo);
    if (!accountNoKey) continue;
    const learnerId = realLearnerId || normalized.learnerId;
    const account: PaymentAccountContext = {
      ...normalized,
      accountNo: accountNoKey,
      learnerId,
      id: learnerId || accountNoKey,
    };
    const key =
      accountNoKey && accountNoKey !== "-"
        ? `account:${accountNoKey}`
        : `learner:${account.learnerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(account);
  }
  return list.sort((a, b) =>
    `${a.accountNo} ${a.surname} ${a.name}`.localeCompare(`${b.accountNo} ${b.surname} ${b.name}`)
  );
}
