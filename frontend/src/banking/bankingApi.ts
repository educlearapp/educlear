import { API_URL } from "../api";

const BASE = `${API_URL}/api/banking`;

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as any)?.error || `Request failed (${res.status})`));
  }
  return data;
}

export type MatchConfidence = "high" | "medium" | "low" | "none";

export type BankingTransactionType = "payment" | "expense" | "transfer" | "ignore";

export type BankTransactionRow = {
  id: string;
  date: string;
  description: string;
  reference: string;
  moneyIn: number;
  moneyOut: number;
  direction: "in" | "out";
  transactionType?: BankingTransactionType;
  suggestedAccountNo: string;
  suggestedLearnerId: string;
  suggestedLearnerName: string;
  matchConfidence: MatchConfidence;
  matchReason: string;
  reviewStatus: "pending" | "accepted" | "unmatched" | "ignored" | "posted";
  expenseCategory: string;
  suggestedSupplierName?: string;
  supplierId?: string;
  expenseNotes?: string;
  postedPaymentId?: string;
  fingerprint: string;
  isDuplicate?: boolean;
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
  const res = await fetch(
    `${BASE}/imports/${encodeURIComponent(importId)}/transaction/${encodeURIComponent(transactionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId, ...payload }),
    }
  );
  return parseJson(res) as Promise<{ success: boolean; transaction: BankTransactionRow; import: BankImportRecord }>;
}

export async function postAcceptedBankPayments(
  schoolId: string,
  importId: string,
  transactionIds?: string[]
) {
  const res = await fetch(`${BASE}/imports/${encodeURIComponent(importId)}/post-payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId, transactionIds }),
  });
  return parseJson(res) as Promise<{
    success: boolean;
    postedCount: number;
    skipped: { transactionId: string; reason: string }[];
    ledgerEntries: Array<Record<string, unknown>>;
    import: BankImportRecord;
  }>;
}
