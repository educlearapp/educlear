import type React from "react";
import type { BankImportRecord, BankTransactionRow, MatchConfidence } from "./bankingApi";

export const SUPPLIERS_STORAGE_PREFIX = "educlearAccountingSuppliers:";

export const BANKING_EXPENSE_CATEGORIES = [
  "Electricity",
  "Water",
  "Rent / Bond",
  "Salaries",
  "Fuel",
  "Repairs & Maintenance",
  "Stationery",
  "Food / Tuckshop",
  "Insurance",
  "Bank Charges",
  "SARS / UIF",
  "Other",
] as const;

export type BankingTransactionType = "payment" | "expense" | "transfer" | "ignore";

export type SupplierForMatch = {
  id: string;
  name: string;
  category: string;
  autoMatchRule?: string;
};

export function loadSuppliersForMatching(schoolId: string): SupplierForMatch[] {
  if (!schoolId) return [];
  try {
    const raw = localStorage.getItem(`${SUPPLIERS_STORAGE_PREFIX}${schoolId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row: Record<string, unknown>) => ({
        id: String(row.id || "").trim(),
        name: String(row.name || "").trim(),
        category: String(row.category || "Other").trim(),
        autoMatchRule: String(row.autoMatchRule || "").trim(),
      }))
      .filter((s) => s.id && s.name);
  } catch {
    return [];
  }
}

export function txnType(txn: BankTransactionRow): BankingTransactionType {
  const t = txn.transactionType as BankingTransactionType | undefined;
  if (t) return t;
  return txn.direction === "in" ? "payment" : "expense";
}

export function suggestedMatchLabel(txn: BankTransactionRow): string {
  const type = txnType(txn);
  if (type === "payment") {
    const acct = txn.suggestedAccountNo || "-";
    const learner = txn.suggestedLearnerName || "";
    return learner ? `${acct} · ${learner}` : acct;
  }
  if (type === "expense") {
    const supplier = txn.suggestedSupplierName || "Unknown supplier";
    const cat = txn.expenseCategory || "Other";
    return `${supplier} · ${cat}`;
  }
  if (type === "transfer") return "Internal transfer";
  return "Ignored";
}

export function isUnmatchedTxn(txn: BankTransactionRow): boolean {
  if (txn.reviewStatus === "unmatched") return true;
  if (txn.reviewStatus === "ignored" || txn.reviewStatus === "posted") return false;
  const type = txnType(txn);
  if (type === "payment" && txn.direction === "in") {
    return txn.matchConfidence === "none" || txn.matchConfidence === "low";
  }
  if (type === "expense" && txn.direction === "out") {
    return !txn.expenseCategory || txn.expenseCategory === "Other";
  }
  return false;
}

export function importSummary(imp: BankImportRecord) {
  const txns = imp.transactions || [];
  let paymentsMatched = 0;
  let expensesMatched = 0;
  let unmatched = 0;

  for (const t of txns) {
    if (isUnmatchedTxn(t)) unmatched += 1;
    if (t.direction === "in" && t.matchConfidence !== "none" && t.matchConfidence !== "low") {
      paymentsMatched += 1;
    }
    if (t.direction === "out" && t.expenseCategory && t.expenseCategory !== "Other") {
      expensesMatched += 1;
    }
  }

  const status =
    unmatched === 0 && txns.length > 0
      ? "Reconciled"
      : txns.some((t) => t.reviewStatus === "posted")
        ? "Partial"
        : "In review";

  return { paymentsMatched, expensesMatched, unmatched, status };
}

export type BankingStats = {
  imports: number;
  matchedPayments: number;
  expenseCandidates: number;
  unmatched: number;
  duplicateLines: number;
  readyToPost: number;
};

export function computeBankingStats(
  imports: BankImportRecord[],
  activeImport: BankImportRecord | null
): BankingStats {
  const imp = activeImport;
  const txns = imp?.transactions || [];

  return {
    imports: imports.length,
    matchedPayments: txns.filter(
      (t) =>
        t.direction === "in" &&
        txnType(t) === "payment" &&
        t.matchConfidence !== "none" &&
        t.reviewStatus !== "ignored"
    ).length,
    expenseCandidates: txns.filter(
      (t) => t.direction === "out" && txnType(t) === "expense" && t.reviewStatus === "accepted"
    ).length,
    unmatched: txns.filter(isUnmatchedTxn).length,
    duplicateLines: txns.filter((t) => t.isDuplicate).length,
    readyToPost: txns.filter(
      (t) =>
        t.direction === "in" &&
        txnType(t) === "payment" &&
        t.reviewStatus === "accepted" &&
        t.matchConfidence !== "none" &&
        t.matchConfidence !== "low"
    ).length,
  };
}

export function paginate<T>(rows: T[], page: number, pageSize = 10) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    totalPages,
    rows: rows.slice(start, start + pageSize),
    total: rows.length,
  };
}

export function confidenceColor(c: MatchConfidence | string) {
  if (c === "high") return "#15803d";
  if (c === "medium") return "#92400e";
  if (c === "low") return "#b45309";
  return "#64748b";
}

export function statusPillStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    textTransform: "capitalize",
  };
  if (status === "posted" || status === "accepted") {
    return { ...base, background: "#dcfce7", color: "#166534" };
  }
  if (status === "ignored") return { ...base, background: "#f1f5f9", color: "#64748b" };
  if (status === "unmatched") return { ...base, background: "#fef3c7", color: "#92400e" };
  return { ...base, background: "#e0e7ff", color: "#3730a3" };
}
