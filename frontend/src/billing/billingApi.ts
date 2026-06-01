import { API_URL } from "../api";
import {
  mergeApiLedger,
  notifyBillingUpdated,
  type BillingLedgerEntry,
  upsertSchoolEntries,
} from "./billingLedger";
import {
  mapApiRowToHistoryEntry,
  readSchoolKidesysHistory,
  writeSchoolKidesysHistory,
  writeStatementApiAccounts,
  writeStatementApiSummaries,
} from "./kidesysTransactionHistory";

const parseArray = (data: any, keys: string[]) => {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

const getJson = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    console.warn(`Billing API returned ${response.status}: ${url}`);
    return null;
  }
  return response.json();
};

const getJsonOrEmptyArray = async (url: string, keys: string[]) => {
  try {
    const data = await getJson(url);
    if (!data) return [];
    return parseArray(data, keys);
  } catch (error) {
    console.warn(`Billing API failed: ${url}`, error);
    return [];
  }
};

const postJson = async (url: string, data: any, fallback = "Request failed") => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, body, fallback));
  }
  return body;
};

export function sanitizeUserFacingError(message: string, fallback: string): string {
  const raw = String(message || "").trim();
  if (!raw) return fallback;
  if (/Invalid `prisma\./i.test(raw) || /invocation in/i.test(raw)) return fallback;
  if (/Unique constraint failed/i.test(raw)) {
    if (/admissionNo/i.test(raw)) {
      return "A learner with this admission number already exists for this school";
    }
    return "This operation conflicts with existing records";
  }
  const firstLine = raw.split("\n")[0]?.trim() || "";
  if (!firstLine || firstLine.length > 240) return fallback;
  return firstLine;
}

function readApiErrorMessage(
  response: Response,
  data: unknown,
  fallback: string
): string {
  const obj =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const fromBody = String(obj?.error || obj?.message || obj?.detail || "").trim();
  if (fromBody) return sanitizeUserFacingError(fromBody, fallback);
  if (response.status === 404) return "Backend route not available";
  if (!response.ok && response.statusText) {
    return `${fallback} (${response.status} ${response.statusText})`;
  }
  return fallback;
}

export const fetchInvoices = async (schoolId: string) =>
  getJsonOrEmptyArray(`${API_URL}/api/invoices?schoolId=${encodeURIComponent(schoolId)}`, [
    "invoices",
    "items",
    "data",
  ]);

export const fetchPayments = async (schoolId: string) =>
  getJsonOrEmptyArray(`${API_URL}/api/payments?schoolId=${encodeURIComponent(schoolId)}`, [
    "payments",
    "items",
    "data",
  ]);

export const fetchStatements = async (schoolId: string) =>
  getJsonOrEmptyArray(`${API_URL}/api/statements?schoolId=${encodeURIComponent(schoolId)}`, [
    "statements",
    "accounts",
    "items",
    "data",
  ]);

function parseKidesysHistoryPayload(data: unknown): any[] {
  return parseArray(data, ["entries", "kidesysHistoryEntries", "history", "items"]);
}

/** Kid-e-Sys display history from API (primary + /accounts fallback for older backends). */
export const fetchKidesysHistory = async (schoolId: string, accountNo?: string) => {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];

  const params = new URLSearchParams({ schoolId: sid });
  if (accountNo) params.set("accountNo", accountNo);

  const primary = await getJson(
    `${API_URL}/api/statements/kidesys-history?${params.toString()}`
  );
  const primaryRows = parseKidesysHistoryPayload(primary);
  if (primaryRows.length) return primaryRows;

  const fallbackParams = new URLSearchParams({
    schoolId: sid,
    includeKidesysHistory: "true",
  });
  if (accountNo) fallbackParams.set("accountNo", accountNo);
  const fallback = await getJson(
    `${API_URL}/api/statements/accounts?${fallbackParams.toString()}`
  );
  return parseKidesysHistoryPayload(fallback);
};

export const fetchLedger = async (schoolId: string) => {
  const data = await getJson(`${API_URL}/api/invoices/ledger?schoolId=${encodeURIComponent(schoolId)}`);
  return parseArray(data, ["entries", "ledger", "items"]);
};

function mapApiRowToLedgerEntry(sid: string, row: any): BillingLedgerEntry {
  const type = String(row.type || "invoice").toLowerCase();
  const entryType: BillingLedgerEntry["type"] =
    type === "payment" || type === "credit" || type === "penalty" ? type : "invoice";
  return {
    id: String(row.id),
    schoolId: sid,
    learnerId: String(row.learnerId || ""),
    accountNo: String(row.accountNo || ""),
    type: entryType,
    amount: Number(row.amount || 0),
    date: String(row.date || row.invoiceDate || row.paymentDate || "").slice(0, 10),
    dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : undefined,
    reference: String(row.reference || row.invoiceNumber || ""),
    description: String(
      row.description ||
        row.message ||
        row.note ||
        row.notes ||
        (entryType === "payment" ? "Payment" : row.type || "Entry")
    ).trim(),
    method: row.method ? String(row.method) : undefined,
    runId: row.runId ? String(row.runId) : undefined,
    bankTransactionId: row.bankTransactionId ? String(row.bankTransactionId) : undefined,
    bankImportId: row.bankImportId ? String(row.bankImportId) : undefined,
    source: row.source ? String(row.source) : undefined,
    createdAt: String(row.createdAt || new Date().toISOString()),
  };
}

/** Merge API rows into the school ledger without removing existing local entries. */
export function applyApiLedgerEntries(schoolId: string, rows: any[]) {
  const sid = String(schoolId || "").trim();
  if (!sid || !rows.length) return;
  const entries = rows.map((row) => mapApiRowToLedgerEntry(sid, row));
  mergeApiLedger(sid, entries);
}

/** Merge a single payment into the school ledger (same upsert path as invoice runs). */
export function upsertPaymentFromApiResponse(
  schoolId: string,
  payment: any,
  overrides?: Partial<
    Pick<
      BillingLedgerEntry,
      | "learnerId"
      | "accountNo"
      | "amount"
      | "date"
      | "reference"
      | "description"
      | "method"
      | "source"
    >
  >
) {
  const sid = String(schoolId || "").trim();
  if (!sid || !payment) return;
  const mapped = mapApiRowToLedgerEntry(sid, { ...payment, type: "payment" });
  const amount = Math.abs(Number(overrides?.amount ?? mapped.amount) || 0);
  const entry: BillingLedgerEntry = {
    ...mapped,
    ...overrides,
    type: "payment",
    amount,
    learnerId: String(overrides?.learnerId ?? mapped.learnerId).trim(),
    accountNo: String(overrides?.accountNo ?? mapped.accountNo).trim(),
  };
  upsertSchoolEntries(sid, [entry]);
}

export const syncKidesysHistoryFromApi = async (schoolId: string) => {
  const sid = String(schoolId || "").trim();
  if (!sid) return;
  const rows = await fetchKidesysHistory(sid);
  if (!rows.length) return;
  writeSchoolKidesysHistory(
    sid,
    rows.map((row: any) => mapApiRowToHistoryEntry(sid, row))
  );
};

export const syncBillingLedgerFromApi = async (schoolId: string) => {
  const sid = String(schoolId || "").trim();
  if (!sid) return;

  const ledgerRows = await fetchLedger(sid);
  if (ledgerRows.length) {
    applyApiLedgerEntries(sid, ledgerRows);
    return;
  }

  const [invoices, payments] = await Promise.all([fetchInvoices(sid), fetchPayments(sid)]);
  const entries: BillingLedgerEntry[] = [
    ...invoices.map((row: any) => mapApiRowToLedgerEntry(sid, { ...row, type: "invoice" })),
    ...payments.map((row: any) =>
      mapApiRowToLedgerEntry(sid, { ...row, type: "payment" })
    ),
  ];

  if (entries.length) {
    mergeApiLedger(sid, entries);
  }
};

/** Cache full statement rows from GET /api/statements (Age Analysis account list). */
export const syncStatementSummariesFromApi = async (schoolId: string) => {
  const sid = String(schoolId || "").trim();
  if (!sid) return;
  const rows = await fetchStatements(sid);
  if (!rows.length) return;
  writeStatementApiAccounts(sid, rows);
  writeStatementApiSummaries(
    sid,
    rows.map((row: any) => ({
      accountNo: String(row.accountNo || ""),
      lastInvoice: Number.isFinite(Number(row.lastInvoice)) ? Number(row.lastInvoice) : 0,
      lastInvoiceDate: String(row.lastInvoiceDate || ""),
      lastInvoiceLabel: row.lastInvoiceLabel ?? null,
      lastPayment: Number.isFinite(Number(row.lastPayment)) ? Number(row.lastPayment) : 0,
      lastPaymentDate: String(row.lastPaymentDate || ""),
    }))
  );
  notifyBillingUpdated();
};

export const syncKidesysHistoryForAccountFromApi = async (
  schoolId: string,
  accountNo: string
) => {
  const sid = String(schoolId || "").trim();
  const ref = String(accountNo || "").trim();
  if (!sid || !ref) return [];
  const rows = await fetchKidesysHistory(sid, ref);
  const mapped = rows.map((row: any) => mapApiRowToHistoryEntry(sid, row));
  if (mapped.length) {
    const existing = readSchoolKidesysHistory(sid);
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const entry of mapped) byId.set(entry.id, entry);
    writeSchoolKidesysHistory(sid, Array.from(byId.values()));
  }
  return mapped;
};

export const undoBillingTransaction = async (
  schoolId: string,
  transactionId: string,
  accountNo: string,
  auditNo?: string | number
) => {
  const sid = String(schoolId || "").trim();
  const id = String(transactionId || "").trim();
  const ref = String(accountNo || "").trim();
  if (!sid || !id) throw new Error("Missing school or transaction id");

  const response = await fetch(
    `${API_URL}/api/billing-transactions/${encodeURIComponent(id)}/undo`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: sid, accountNo: ref, auditNo }),
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(body?.error || "Failed to undo transaction"));
  }
  if (Array.isArray(body?.accounts)) {
    writeStatementApiAccounts(sid, body.accounts);
    writeStatementApiSummaries(
      sid,
      body.accounts.map((row: any) => ({
        accountNo: String(row.accountNo || ""),
        lastInvoice: Number.isFinite(Number(row.lastInvoice)) ? Number(row.lastInvoice) : 0,
        lastInvoiceDate: String(row.lastInvoiceDate || ""),
        lastInvoiceLabel: row.lastInvoiceLabel ?? null,
        lastPayment: Number.isFinite(Number(row.lastPayment)) ? Number(row.lastPayment) : 0,
        lastPaymentDate: String(row.lastPaymentDate || ""),
      }))
    );
  }
  notifyBillingUpdated();
  return body;
};

/** Sync Age Analysis accounts + Kid-e-Sys history + ledger from API (display source of truth). */
export async function refreshBillingFromApi(schoolId: string) {
  const sid = String(schoolId || "").trim();
  if (!sid) return;
  await syncStatementSummariesFromApi(sid).catch(() => {});
  await syncKidesysHistoryFromApi(sid).catch(() => {});
  await syncBillingLedgerFromApi(sid);
  notifyBillingUpdated();
}

export const fetchBillingDocuments = async (schoolId: string) =>
  getJson(`${API_URL}/api/billing-documents?schoolId=${encodeURIComponent(schoolId)}`);

export const sendBillingStatements = async (payload: Record<string, unknown>) => {
  const response = await fetch(`${API_URL}/api/billing-documents/send-statements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, simulate: true }),
  });
  if (!response.ok) throw new Error("Failed to send statements");
  return response.json();
};

export const previewLatePenalties = async (payload: Record<string, unknown>) => {
  const response = await fetch(`${API_URL}/api/billing/late-penalties/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to preview penalties");
  return response.json();
};

export const applyLatePenalties = async (payload: Record<string, unknown>) => {
  const response = await fetch(`${API_URL}/api/billing/late-penalties/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to apply penalties");
  return response.json();
};

export type LegalDocumentType = "section-41-notice" | "letter-of-demand" | "final-demand";

export const previewLegalDocuments = async (payload: Record<string, unknown>) => {
  const response = await fetch(`${API_URL}/api/legal-billing-documents/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as any)?.error || "Failed to preview legal documents"));
  }
  return data;
};

export const generateLegalDocuments = async (payload: Record<string, unknown>) => {
  const response = await fetch(`${API_URL}/api/legal-billing-documents/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as any)?.error || "Failed to generate legal documents"));
  }
  return data;
};

export const sendLegalDocuments = async (payload: Record<string, unknown>) => {
  const response = await fetch(`${API_URL}/api/legal-billing-documents/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, simulate: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as any)?.error || "Failed to send legal documents"));
  }
  return data;
};

export const fetchLegalDocumentHistory = async (schoolId: string, documentType?: string) => {
  const params = new URLSearchParams({ schoolId });
  if (documentType) params.set("documentType", documentType);
  return getJson(`${API_URL}/api/legal-billing-documents/history?${params.toString()}`);
};

export const createInvoice = async (data: any) =>
  postJson(`${API_URL}/api/invoices`, data, "Failed to create invoice");

export const createPayment = async (data: any) =>
  postJson(`${API_URL}/api/payments`, data, "Failed to create payment");

export const mergeFamilyAccount = async (payload: {
  schoolId: string;
  sourceFamilyAccountId?: string;
  sourceAccountRef?: string;
  sourceLearnerId?: string;
  targetFamilyAccountId?: string;
  targetAccountRef?: string;
  targetLearnerId?: string;
  actorEmail?: string;
}) => {
  const response = await fetch(`${API_URL}/api/family-accounts/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      readApiErrorMessage(response, data, "Failed to merge family accounts")
    );
  }
  const result = data as { success?: boolean; error?: string };
  if (result?.success === false) {
    throw new Error(String(result.error || "Failed to merge family accounts"));
  }
  return data;
};

export const unmergeFamilyAccount = async (payload: {
  schoolId: string;
  learnerId: string;
  createNewAccount: boolean;
  actorEmail?: string;
}) => {
  const response = await fetch(`${API_URL}/api/family-accounts/unmerge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, "Failed to unmerge learner"));
  }
  const result = data as { success?: boolean; error?: string };
  if (result?.success === false) {
    throw new Error(String(result.error || "Failed to unmerge learner"));
  }
  return data;
};

export const fetchFamilyAccountAudit = async (schoolId: string, limit = 50) => {
  const params = new URLSearchParams({ schoolId, limit: String(limit) });
  return getJson(`${API_URL}/api/family-accounts/audit?${params.toString()}`);
};

export const fetchOpenInvoices = async (
  schoolId: string,
  learnerId: string,
  accountNo: string
) => {
  const params = new URLSearchParams({
    schoolId,
    learnerId: String(learnerId || ""),
    accountNo: String(accountNo || ""),
  });
  const data = await getJson(
    `${API_URL}/api/payments/open-invoices?${params.toString()}`
  );
  if (!data) {
    return { openInvoices: [] as any[], balance: 0 };
  }
  return {
    openInvoices: parseArray(data, ["openInvoices", "items"]),
    balance: Number((data as any)?.balance || 0),
  };
};
