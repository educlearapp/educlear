import type { BankTransactionRow, MatchConfidence } from "../banking/bankingApi";

export const EXPENSE_CANDIDATES_STORAGE_PREFIX = "educlearAccountingExpenseCandidates:";
export const APPROVED_EXPENSES_STORAGE_PREFIX = "educlearAccountingApprovedExpenses:";
export const ACCOUNTING_EXPENSES_UPDATED_EVENT = "educlear-accounting-expenses-updated";
/** Legacy combined store — recurring rules only after migration */
export const LEGACY_EXPENSES_STORAGE_PREFIX = "educlearAccountingExpenses:";

export type ExpenseCandidateStatus = "Pending" | "Ignored" | "Duplicate" | "Category updated";

export type AccountingExpenseCandidate = {
  id: string;
  importId: string;
  transactionId: string;
  date: string;
  category: string;
  supplier: string;
  description: string;
  amount: number;
  confidence: "high" | "medium" | "low";
  source: "Bank Import";
  status: ExpenseCandidateStatus;
  notes: string;
  fingerprint: string;
  reference?: string;
};

export type AccountingApprovedExpense = {
  id: string;
  date: string;
  supplier: string;
  category: string;
  description: string;
  amount: number;
  source: "Bank Import" | "Manual" | "Sample";
  approvedBy: string;
  reference?: string;
  notes?: string;
  approvedAt: string;
  fingerprint?: string;
  bankImportId?: string;
  bankTransactionId?: string;
};

function candidatesKey(schoolId: string) {
  return EXPENSE_CANDIDATES_STORAGE_PREFIX + schoolId;
}

function approvedKey(schoolId: string) {
  return APPROVED_EXPENSES_STORAGE_PREFIX + schoolId;
}

function legacyKey(schoolId: string) {
  return LEGACY_EXPENSES_STORAGE_PREFIX + schoolId;
}

function mapConfidence(raw: MatchConfidence): AccountingExpenseCandidate["confidence"] {
  if (raw === "high") return "high";
  if (raw === "medium") return "medium";
  return "low";
}

export function loadExpenseCandidates(schoolId: string): AccountingExpenseCandidate[] {
  try {
    const raw = localStorage.getItem(candidatesKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExpenseCandidates(schoolId: string, rows: AccountingExpenseCandidate[]) {
  try {
    localStorage.setItem(candidatesKey(schoolId), JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

export function loadApprovedExpenses(schoolId: string): AccountingApprovedExpense[] {
  try {
    const raw = localStorage.getItem(approvedKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function dispatchAccountingExpensesUpdated(schoolId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ACCOUNTING_EXPENSES_UPDATED_EVENT, { detail: { schoolId: String(schoolId || "").trim() } })
  );
}

export function saveApprovedExpenses(schoolId: string, rows: AccountingApprovedExpense[]) {
  try {
    localStorage.setItem(approvedKey(schoolId), JSON.stringify(rows));
    dispatchAccountingExpensesUpdated(schoolId);
  } catch {
    /* quota */
  }
}

/** Case-insensitive category key for Budget ↔ Expenses matching */
export function normalizeExpenseCategory(category: unknown): string {
  return String(category ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseExpenseYearMonth(dateRaw: string): { year: number; monthIndex: number } | null {
  const raw = String(dateRaw || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]);
    const monthIndex = Number(iso[2]) - 1;
    if (year >= 1970 && monthIndex >= 0 && monthIndex <= 11) return { year, monthIndex };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

export function filterApprovedExpensesForMonth(
  rows: AccountingApprovedExpense[],
  year: number,
  monthIndex: number
): AccountingApprovedExpense[] {
  return rows.filter((row) => {
    const parsed = parseExpenseYearMonth(row.date);
    return parsed?.year === year && parsed?.monthIndex === monthIndex;
  });
}

export type ApprovedSpendByCategory = {
  /** Normalized key → total amount */
  totals: Map<string, number>;
  /** Normalized key → display label (first seen casing) */
  labels: Map<string, string>;
};

export function sumApprovedExpensesByCategory(
  rows: AccountingApprovedExpense[],
  year: number,
  monthIndex: number
): ApprovedSpendByCategory {
  const totals = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const row of filterApprovedExpensesForMonth(rows, year, monthIndex)) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = normalizeExpenseCategory(row.category);
    if (!key) continue;
    totals.set(key, (totals.get(key) || 0) + amount);
    if (!labels.has(key)) {
      labels.set(key, String(row.category || "").trim() || key);
    }
  }
  return { totals, labels };
}

export function actualSpendForBudgetCategory(
  spend: ApprovedSpendByCategory,
  category: unknown
): number {
  const key = normalizeExpenseCategory(category);
  if (!key) return 0;
  const value = spend.totals.get(key) ?? 0;
  return Number.isFinite(value) ? value : 0;
}

export function totalApprovedSpendForMonth(
  rows: AccountingApprovedExpense[],
  year: number,
  monthIndex: number
): number {
  return filterApprovedExpensesForMonth(rows, year, monthIndex).reduce((sum, row) => {
    const amount = Number(row.amount);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
}

export function buildExpenseCandidateFromBankTxn(
  importId: string,
  txn: BankTransactionRow
): AccountingExpenseCandidate {
  const supplier = String(txn.suggestedSupplierName || txn.description || "Unknown").trim();
  const category = String(txn.expenseCategory || "Other").trim() || "Other";
  return {
    id: `bank-${importId}-${txn.id}`,
    importId,
    transactionId: txn.id,
    date: txn.date,
    category,
    supplier,
    description: String(txn.reference || txn.description || "").trim() || "Bank transaction",
    amount: txn.moneyOut,
    confidence: mapConfidence(txn.matchConfidence),
    source: "Bank Import",
    status: "Pending",
    notes: String(txn.expenseNotes || "").trim(),
    fingerprint: txn.fingerprint,
    reference: txn.reference || undefined,
  };
}

export type AddExpenseCandidateResult = "added" | "duplicate";

export function addExpenseCandidateFromBank(
  schoolId: string,
  importId: string,
  txn: BankTransactionRow
): AddExpenseCandidateResult {
  const candidates = loadExpenseCandidates(schoolId);
  const fingerprint = String(txn.fingerprint || "").trim();
  if (
    fingerprint &&
    candidates.some(
      (c) => c.fingerprint === fingerprint && c.status !== "Ignored"
    )
  ) {
    const existing = candidates.find((c) => c.fingerprint === fingerprint);
    if (existing && existing.status !== "Duplicate") {
      existing.status = "Duplicate";
      saveExpenseCandidates(schoolId, candidates);
    }
    return "duplicate";
  }

  const row = buildExpenseCandidateFromBankTxn(importId, txn);
  const withoutSameId = candidates.filter((c) => c.id !== row.id);
  withoutSameId.unshift(row);
  saveExpenseCandidates(schoolId, withoutSameId);
  return "added";
}

export function updateExpenseCandidate(
  schoolId: string,
  candidateId: string,
  patch: Partial<Pick<AccountingExpenseCandidate, "category" | "supplier" | "description" | "notes" | "status">>
): AccountingExpenseCandidate[] {
  const next = loadExpenseCandidates(schoolId).map((c) =>
    c.id === candidateId
      ? {
          ...c,
          ...patch,
          status: (patch.status || (patch.category ? "Category updated" : c.status)) as ExpenseCandidateStatus,
        }
      : c
  );
  saveExpenseCandidates(schoolId, next);
  return next;
}

export function ignoreExpenseCandidate(schoolId: string, candidateId: string): AccountingExpenseCandidate[] {
  const next = loadExpenseCandidates(schoolId).map((c) =>
    c.id === candidateId ? { ...c, status: "Ignored" as const } : c
  );
  saveExpenseCandidates(schoolId, next);
  return next;
}

export function acceptExpenseCandidate(
  schoolId: string,
  candidateId: string,
  approvedBy: string
): { candidates: AccountingExpenseCandidate[]; approved: AccountingApprovedExpense[] } {
  const candidates = loadExpenseCandidates(schoolId);
  const target = candidates.find((c) => c.id === candidateId);
  if (!target) {
    return { candidates, approved: loadApprovedExpenses(schoolId) };
  }

  const approvedRow: AccountingApprovedExpense = {
    id: `approved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: target.date,
    supplier: target.supplier,
    category: target.category,
    description: target.description,
    amount: target.amount,
    source: "Bank Import",
    approvedBy,
    reference: target.reference,
    notes: target.notes || undefined,
    approvedAt: new Date().toISOString(),
    fingerprint: target.fingerprint,
    bankImportId: target.importId,
    bankTransactionId: target.transactionId,
  };

  const approved = [approvedRow, ...loadApprovedExpenses(schoolId)];
  const remaining = candidates.filter((c) => c.id !== candidateId);
  saveApprovedExpenses(schoolId, approved);
  saveExpenseCandidates(schoolId, remaining);
  return { candidates: remaining, approved };
}

export function addManualApprovedExpense(
  schoolId: string,
  expense: AccountingApprovedExpense
): AccountingApprovedExpense[] {
  const approved = [expense, ...loadApprovedExpenses(schoolId)];
  saveApprovedExpenses(schoolId, approved);
  return approved;
}

export function reviewQueueFromCandidates(candidates: AccountingExpenseCandidate[]) {
  return candidates.filter((c) => c.status === "Pending" || c.status === "Category updated");
}

/** One-time migration from legacy combined localStorage store */
export function migrateLegacyExpenseStores(schoolId: string): boolean {
  let migrated = false;
  const existingCandidates = loadExpenseCandidates(schoolId);
  const existingApproved = loadApprovedExpenses(schoolId);

  if (!existingCandidates.length && !existingApproved.length) {
    try {
      const raw = localStorage.getItem(legacyKey(schoolId));
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        reviewQueue?: Array<Record<string, unknown>>;
        approved?: AccountingApprovedExpense[];
      };
      if (Array.isArray(parsed.reviewQueue) && parsed.reviewQueue.length) {
        const mapped: AccountingExpenseCandidate[] = parsed.reviewQueue
          .filter((r) => r.source === "bank")
          .map((r) => ({
            id: String(r.id || ""),
            importId: String(r.bankImportId || ""),
            transactionId: String(r.bankTransactionId || ""),
            date: String(r.date || ""),
            category: String(r.suggestedCategory || "Other"),
            supplier: String(r.supplier || ""),
            description: String(r.description || ""),
            amount: Number(r.amount) || 0,
            confidence: (r.confidence as AccountingExpenseCandidate["confidence"]) || "low",
            source: "Bank Import" as const,
            status: (r.status === "Category updated" ? "Category updated" : "Pending") as ExpenseCandidateStatus,
            notes: "",
            fingerprint: `legacy-${String(r.id || "")}`,
            reference: r.reference ? String(r.reference) : undefined,
          }))
          .filter((r) => r.id && r.importId);
        if (mapped.length) {
          saveExpenseCandidates(schoolId, mapped);
          migrated = true;
        }
      }
      if (Array.isArray(parsed.approved) && parsed.approved.length) {
        const approved = parsed.approved.map((row: Record<string, unknown>) => {
          const rawSource = String(row.source || "");
          const source =
            rawSource.toLowerCase() === "bank import" ? ("Bank Import" as const) : rawSource;
          return {
            ...(row as AccountingApprovedExpense),
            source: (source === "Manual" || source === "Sample" || source === "Bank Import"
              ? source
              : "Manual") as AccountingApprovedExpense["source"],
          };
        });
        saveApprovedExpenses(schoolId, approved);
        migrated = true;
      }
    } catch {
      /* ignore */
    }
  }
  return migrated;
}

export function loadLegacyRecurringRules(schoolId: string): unknown[] {
  try {
    const raw = localStorage.getItem(legacyKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.recurringRules) ? parsed.recurringRules : [];
  } catch {
    return [];
  }
}
