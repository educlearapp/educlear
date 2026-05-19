import { API_URL } from "../api";

const BASE = `${API_URL}/api/banking`;

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as any)?.error || `Request failed (${res.status})`));
  }
  if (data && typeof data === "object" && (data as { success?: boolean }).success === false) {
    throw new Error(String((data as { error?: string }).error || "Request failed"));
  }
  return data;
}

export type MatchConfidence = "high" | "medium" | "low" | "none";

export type BankingTransactionType = "payment" | "expense" | "transfer" | "ignore";

export type BankTransactionMatchStatus =
  | "imported"
  | "suggested"
  | "matched"
  | "unmatched"
  | "duplicate"
  | "ready_to_post";

export type BankTransactionRow = {
  id: string;
  date: string;
  description: string;
  reference: string;
  moneyIn: number;
  moneyOut: number;
  direction: "in" | "out";
  transactionType?: BankingTransactionType;
  suggestedAccountId: string;
  suggestedAccountNo: string;
  suggestedLearnerId: string;
  suggestedLearnerName: string;
  confidenceScore: number;
  matchConfidence: MatchConfidence;
  matchReason: string;
  reviewStatus: "pending" | "accepted" | "unmatched" | "ignored" | "posted";
  matchStatus?: BankTransactionMatchStatus;
  expenseCategory: string;
  suggestedSupplierName?: string;
  supplierId?: string;
  suggestedInvoiceId?: string;
  suggestedInvoiceNumber?: string;
  invoiceMatchScore?: number;
  expenseNotes?: string;
  postedPaymentId?: string;
  fingerprint: string;
  isDuplicate?: boolean;
};

export type BankingStats = {
  imports: number;
  matchedPayments: number;
  suggestedPayments: number;
  expenseCandidates: number;
  unmatched: number;
  duplicateLines: number;
  readyToPost: number;
};

export type BankImportRecord = {
  id: string;
  schoolId: string;
  fileName: string;
  format: string;
  importedAt: string;
  transactions: BankTransactionRow[];
};

export const EXPENSE_CATEGORIES = [
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

export type SupplierMatchPayload = {
  id: string;
  name: string;
  category: string;
  autoMatchRule?: string;
};

export async function importBankStatement(
  schoolId: string,
  file: File,
  suppliers?: SupplierMatchPayload[]
) {
  const form = new FormData();
  form.append("schoolId", schoolId);
  form.append("file", file);
  if (suppliers?.length) form.append("suppliers", JSON.stringify(suppliers));
  const res = await fetch(`${BASE}/import`, { method: "POST", body: form });
  return parseJson(res) as Promise<{
    success: boolean;
    import: BankImportRecord;
    expenseCategories: string[];
    accountingNote: string;
  }>;
}

export async function fetchBankImports(schoolId: string) {
  const res = await fetch(`${BASE}/imports?schoolId=${encodeURIComponent(schoolId)}`);
  return parseJson(res) as Promise<{ success: boolean; imports: BankImportRecord[] }>;
}

export async function fetchBankingStats(schoolId: string, importId?: string) {
  const params = new URLSearchParams({ schoolId });
  if (importId) params.set("importId", importId);
  const res = await fetch(`${BASE}/stats?${params.toString()}`);
  return parseJson(res) as Promise<{ success: boolean; stats: BankingStats }>;
}

export async function fetchBankTransactions(
  schoolId: string,
  options?: { importId?: string; matchStatus?: BankTransactionMatchStatus }
) {
  const params = new URLSearchParams({ schoolId });
  if (options?.importId) params.set("importId", options.importId);
  if (options?.matchStatus) params.set("matchStatus", options.matchStatus);
  const res = await fetch(`${BASE}/transactions?${params.toString()}`);
  return parseJson(res) as Promise<{ success: boolean; transactions: BankTransactionRow[] }>;
}

export async function fetchBankImport(schoolId: string, importId: string) {
  const res = await fetch(
    `${BASE}/imports/${encodeURIComponent(importId)}?schoolId=${encodeURIComponent(schoolId)}`
  );
  return parseJson(res) as Promise<{
    success: boolean;
    import: BankImportRecord;
    expenseCategories: string[];
    accountingNote: string;
  }>;
}

export async function patchBankTransaction(
  schoolId: string,
  importId: string,
  transactionId: string,
  payload: Record<string, unknown>
) {
  console.log("PATCH START", { importId, transactionId, payload });
  try {
    const res = await fetch(
      `${BASE}/imports/${encodeURIComponent(importId)}/transaction/${encodeURIComponent(transactionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, ...payload }),
      }
    );
    const data = (await parseJson(res)) as {
      success: boolean;
      transaction: BankTransactionRow;
      import: BankImportRecord;
    };
    console.log("PATCH SUCCESS", {
      transactionId,
      reviewStatus: data.transaction?.reviewStatus,
      matchStatus: data.transaction?.matchStatus,
    });
    return data;
  } catch (e) {
    console.log("PATCH FAILED", { transactionId, error: e });
    throw e;
  }
}

export async function postAcceptedBankPayments(
  schoolId: string,
  importId: string,
  transactionIds?: string[]
) {
  try {
    const res = await fetch(`${BASE}/imports/${encodeURIComponent(importId)}/post-payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId, transactionIds }),
    });
    const data = (await parseJson(res)) as {
      success: boolean;
      postedCount: number;
      skipped: { transactionId: string; reason: string }[];
      ledgerEntries: Array<Record<string, unknown>>;
      import: BankImportRecord;
    };
    console.log("POST PAYMENTS SUCCESS", {
      importId,
      postedCount: data.postedCount,
      skipped: data.skipped?.length || 0,
    });
    return data;
  } catch (e) {
    console.log("POST PAYMENTS FAILED", { importId, error: e });
    throw e;
  }
}
