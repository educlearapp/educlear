import type { BankTransactionRow, MatchConfidence } from "../banking/bankingApi";

export const EXPENSE_CANDIDATES_STORAGE_PREFIX = "educlearAccountingExpenseCandidates:";
export const APPROVED_EXPENSES_STORAGE_PREFIX = "educlearAccountingApprovedExpenses:";
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

export function saveApprovedExpenses(schoolId: string, rows: AccountingApprovedExpense[]) {
  try {
    localStorage.setItem(approvedKey(schoolId), JSON.stringify(rows));
  } catch {
    /* quota */
  }
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
