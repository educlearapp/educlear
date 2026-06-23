import { API_URL } from "../api";
import {
  mergeApiLedger,
  notifyBillingUpdated,
  replaceSchoolLedgerFromApi,
  type BillingLedgerEntry,
  upsertSchoolEntries,
} from "./billingLedger";
import { clearSchoolBillingDisplayCache } from "./kidesysTransactionHistory";
import {
  mapApiRowToHistoryEntry,
  readSchoolKidesysHistory,
  readStatementApiAccounts,
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

/** Dev-only save timing (Vite import.meta.env.DEV). */
export const isBillingSaveTimingEnabled =
  typeof import.meta !== "undefined" &&
  Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

export function logBillingSaveTiming(phase: string, elapsedMs: number) {
  if (!isBillingSaveTimingEnabled) return;
  console.debug(`[billing-save] ${phase}: ${elapsedMs.toFixed(0)}ms`);
}

const ledgerNotifySilent = { notify: false as const };

function mergeLedgerEntriesSilent(schoolId: string, entries: BillingLedgerEntry[]) {
  if (!entries.length) return;
  upsertSchoolEntries(schoolId, entries, ledgerNotifySilent);
}

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
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, body, fallback));
  }
  if (body && typeof body === "object" && (body as { success?: boolean }).success === false) {
    throw new Error(readApiErrorMessage(response, body, fallback));
  }
  return body;
};

export function sanitizeUserFacingError(message: string, fallback: string): string {
  const raw = String(message || "").trim();
  if (!raw) return fallback;
  if (
    /Invalid `prisma\./i.test(raw) ||
    /invocation in/i.test(raw) ||
    /Server has closed the connection/i.test(raw) ||
    /Can't reach database server/i.test(raw)
  ) {
    return "Billing service temporarily unavailable. Please try again.";
  }
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

function readErrorCode(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  return String((data as Record<string, unknown>).errorCode || "").trim();
}

function readApiErrorMessage(
  response: Response,
  data: unknown,
  fallback: string
): string {
  const errorCode = readErrorCode(data);
  if (errorCode === "BILLING_SERVICE_UNAVAILABLE") {
    return "Billing service temporarily unavailable. Please try again.";
  }
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

export type { InvoiceBatchSaveResult } from "./invoiceBatchSave";
export { assertInvoiceBatchSaveSucceeded } from "./invoiceBatchSave";

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

export type StatementAccountTransactionRow = {
  key: string;
  ledgerEntryId?: string;
  auditNo: string | number;
  date: string;
  type: string;
  method: string;
  learner: string;
  reference: string;
  description: string;
  amountIn: number;
  amountOut: number;
  balance: number | null;
  isKidesysHistory: boolean;
  isOpeningBalance: boolean;
  canUndo: boolean;
};

export const fetchStatementAccountTransactions = async (
  schoolId: string,
  options: {
    accountNo?: string;
    learnerId?: string;
    period?: string;
    showCorrectionsAudit?: boolean;
  }
): Promise<StatementAccountTransactionRow[]> => {
  const sid = String(schoolId || "").trim();
  const accountNo = String(options.accountNo || "").trim();
  const learnerId = String(options.learnerId || "").trim();
  if (!sid || (!accountNo && !learnerId)) return [];

  const params = new URLSearchParams({ schoolId: sid });
  if (accountNo) params.set("accountNo", accountNo);
  if (learnerId) params.set("learnerId", learnerId);
  if (options.period) params.set("period", String(options.period));
  if (options.showCorrectionsAudit) params.set("showCorrections", "true");

  const data = await getJson(`${API_URL}/api/statements/transactions?${params.toString()}`);
  if (!data || (data as { success?: boolean }).success === false) return [];
  return Array.isArray((data as { transactions?: unknown }).transactions)
    ? ((data as { transactions: StatementAccountTransactionRow[] }).transactions || [])
    : [];
};

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
    statementHidden: row.statementHidden === true ? true : undefined,
    undoneAt: row.undoneAt ? String(row.undoneAt) : undefined,
    undoneByCorrectionId: row.undoneByCorrectionId
      ? String(row.undoneByCorrectionId)
      : undefined,
    correctsEntryId: row.correctsEntryId ? String(row.correctsEntryId) : undefined,
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
  >,
  opts?: { notify?: boolean }
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
  upsertSchoolEntries(sid, [entry], opts?.notify === false ? ledgerNotifySilent : undefined);
}

export type PostOpenInvoiceRow = {
  id: string;
  audit: string;
  type: string;
  date: string;
  reference: string;
  description: string;
  unpaid: number;
  amount: number;
};

/** Map open-invoice rows from POST /api/payments (or open-invoices GET). */
export function mapPostOpenInvoiceRows(rows: unknown[]): PostOpenInvoiceRow[] {
  return rows.map((row: any) => ({
    id: String(row.id || ""),
    audit: String(row.audit || row.id || ""),
    type: String(row.type || "Invoice"),
    date: String(row.date || "").slice(0, 10),
    reference: String(row.reference || ""),
    description: String(row.description || ""),
    unpaid: Number(row.unpaid || 0),
    amount: Number(row.amount || row.unpaid || 0),
  }));
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
    const entries = ledgerRows.map((row: any) => mapApiRowToLedgerEntry(sid, row));
    replaceSchoolLedgerFromApi(sid, entries);
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
    replaceSchoolLedgerFromApi(sid, entries);
  }
};

export type BillingStatementSyncState = {
  loading: boolean;
  confirmedEmpty: boolean;
  syncFailed: boolean;
};

const syncStateBySchool: Record<string, BillingStatementSyncState> = {};

export function getBillingStatementSyncState(schoolId: string): BillingStatementSyncState {
  const key = String(schoolId || "").trim();
  return (
    syncStateBySchool[key] || {
      loading: false,
      confirmedEmpty: false,
      syncFailed: false,
    }
  );
}

function patchBillingStatementSyncState(
  schoolId: string,
  patch: Partial<BillingStatementSyncState>
) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  syncStateBySchool[key] = { ...getBillingStatementSyncState(key), ...patch };
}

export async function fetchStatementsWithStatus(
  schoolId: string
): Promise<{ ok: boolean; rows: any[] }> {
  const sid = String(schoolId || "").trim();
  if (!sid) return { ok: false, rows: [] };
  const url = `${API_URL}/api/statements?schoolId=${encodeURIComponent(sid)}`;
  try {
    const data = await getJson(url);
    if (!data) return { ok: false, rows: [] };
    return {
      ok: true,
      rows: parseArray(data, ["statements", "accounts", "items", "data"]),
    };
  } catch (error) {
    console.warn(`Billing API failed: ${url}`, error);
    return { ok: false, rows: [] };
  }
}

const mapStatementSummaryRows = (rows: any[]) =>
  rows.map((row: any) => ({
    accountNo: String(row.accountNo || ""),
    lastInvoice: Number.isFinite(Number(row.lastInvoice)) ? Number(row.lastInvoice) : 0,
    lastInvoiceDate: String(row.lastInvoiceDate || ""),
    lastInvoiceLabel: row.lastInvoiceLabel ?? null,
    lastPayment: Number.isFinite(Number(row.lastPayment)) ? Number(row.lastPayment) : 0,
    lastPaymentDate: String(row.lastPaymentDate || ""),
  }));

/** Cache full statement rows from GET /api/statements (Age Analysis account list). */
export const syncStatementSummariesFromApi = async (
  schoolId: string
): Promise<{ ok: boolean; count: number }> => {
  const sid = String(schoolId || "").trim();
  if (!sid) return { ok: false, count: 0 };
  const { ok, rows } = await fetchStatementsWithStatus(sid);
  if (!ok) {
    patchBillingStatementSyncState(sid, { confirmedEmpty: false, syncFailed: true });
    return { ok: false, count: readStatementApiAccounts(sid).length };
  }
  if (!rows.length) {
    writeStatementApiAccounts(sid, []);
    writeStatementApiSummaries(sid, []);
    patchBillingStatementSyncState(sid, { confirmedEmpty: true, syncFailed: false });
    notifyBillingUpdated();
    return { ok: true, count: 0 };
  }
  writeStatementApiAccounts(sid, rows);
  writeStatementApiSummaries(sid, mapStatementSummaryRows(rows));
  patchBillingStatementSyncState(sid, { confirmedEmpty: false, syncFailed: false });
  notifyBillingUpdated();
  return { ok: true, count: rows.length };
};

/** Clear in-memory billing display cache on school switch or logout only. */
export function clearBillingDisplayCacheForSchoolSwitch(schoolId: string) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  clearSchoolBillingDisplayCache(key);
  delete syncStateBySchool[key];
}

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
  if (Array.isArray(body?.ledgerEntries) && body.ledgerEntries.length) {
    applyApiLedgerEntries(sid, body.ledgerEntries);
  } else if (body?.original || body?.correction) {
    applyApiLedgerEntries(
      sid,
      [body.original, body.correction].filter(Boolean)
    );
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
  patchBillingStatementSyncState(sid, { loading: true });
  try {
    await syncStatementSummariesFromApi(sid).catch(() => {});
    await syncKidesysHistoryFromApi(sid).catch(() => {});
    await syncBillingLedgerFromApi(sid);
    notifyBillingUpdated();
  } finally {
    patchBillingStatementSyncState(sid, { loading: false });
  }
}

export const fetchBillingServerEnv = async () =>
  getJson(`${API_URL}/api/payments/env`);

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

export const createInvoicesBatch = async (data: {
  schoolId: string;
  runId?: string;
  invoices: Record<string, unknown>[];
}) =>
  postJson(`${API_URL}/api/invoices/batch`, data, "Failed to create invoices");

export type InvoiceRunExecutePayload = {
  schoolId: string;
  runId: string;
  invoicePeriod: string;
  invoiceDate: string;
  dueDate?: string;
  description?: string;
  dryRun?: boolean;
  learnerIds?: string[];
  extraFeesByLearnerId?: Record<string, { feeDescription: string; amount: number }[]>;
};

async function postInvoiceRunEndpoint(
  path: "/api/invoice-runs/preview" | "/api/invoice-runs/execute",
  payload: InvoiceRunExecutePayload,
  fallback: string
) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 422) {
    return body;
  }
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, body, fallback));
  }
  if (body && typeof body === "object" && (body as { success?: boolean }).success === false) {
    const errorCode = String((body as { errorCode?: string }).errorCode || "");
    if (errorCode === "INTEGRITY_GATE_FAILED") return body;
    throw new Error(readApiErrorMessage(response, body, fallback));
  }
  return body;
}

export const previewInvoiceRun = async (payload: InvoiceRunExecutePayload) =>
  postInvoiceRunEndpoint(
    "/api/invoice-runs/preview",
    { ...payload, dryRun: true },
    "Failed to preview invoice run"
  );

export const executeInvoiceRun = async (payload: InvoiceRunExecutePayload) =>
  postInvoiceRunEndpoint(
    "/api/invoice-runs/execute",
    { ...payload, dryRun: false },
    "Failed to execute invoice run"
  );

export function applyInvoiceRunExecuteResponse(
  schoolId: string,
  body: Record<string, unknown> | null | undefined
) {
  if (!body) return;
  applyInvoiceSaveResponse(schoolId, {
    invoices: body.invoices,
    accounts: body.accounts,
    statements: body.accounts,
  });
}

export const createPayment = async (data: Record<string, unknown>) =>
  postJson(`${API_URL}/api/payments`, data, "Failed to create payment");

/** Merge one updated account row into cached GET /api/statements data. */
export function patchStatementApiAccount(schoolId: string, accountRow: unknown) {
  const sid = String(schoolId || "").trim();
  if (!sid || !accountRow || typeof accountRow !== "object") return;
  const ref = String((accountRow as { accountNo?: string }).accountNo || "")
    .trim()
    .toUpperCase();
  if (!ref) return;

  const existing = readStatementApiAccounts(sid);
  const rows = Array.isArray(existing) ? [...existing] : [];
  const idx = rows.findIndex(
    (row: any) => String(row?.accountNo || "").trim().toUpperCase() === ref
  );
  if (idx >= 0) {
    rows[idx] = { ...(rows[idx] as object), ...(accountRow as object) };
  } else {
    rows.push(accountRow);
  }

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
}

/** Apply invoice POST/batch response — authoritative balance + statement cache patch. */
export function applyInvoiceSaveResponse(
  schoolId: string,
  body: Record<string, unknown> | null | undefined
) {
  const sid = String(schoolId || "").trim();
  if (!sid || !body) return;

  const invoice = body.invoice;
  const invoices = body.invoices;
  const ledgerEntries = body.ledgerEntries;
  const ledgerRowsToMerge: BillingLedgerEntry[] = [];

  if (invoice && typeof invoice === "object") {
    ledgerRowsToMerge.push(
      mapApiRowToLedgerEntry(sid, { ...(invoice as object), type: "invoice" })
    );
  }
  if (Array.isArray(invoices) && invoices.length) {
    ledgerRowsToMerge.push(
      ...invoices.map((row) =>
        mapApiRowToLedgerEntry(sid, { ...(row as object), type: "invoice" })
      )
    );
  }
  if (Array.isArray(ledgerEntries) && ledgerEntries.length) {
    ledgerRowsToMerge.push(
      ...ledgerEntries.map((row) => mapApiRowToLedgerEntry(sid, row))
    );
  }
  mergeLedgerEntriesSilent(sid, ledgerRowsToMerge);

  const account = body.account;
  if (account && typeof account === "object") {
    patchStatementApiAccount(sid, account);
  }

  const accounts = body.accounts ?? body.statements;
  if (Array.isArray(accounts) && accounts.length) {
    for (const row of accounts) {
      patchStatementApiAccount(sid, row);
    }
  }

  notifyBillingUpdated();
}

/** Apply payment POST response (balance, statements, ledger) without stale local merges. */
export function applyPaymentSaveResponse(
  schoolId: string,
  body: Record<string, unknown> | null | undefined
) {
  const sid = String(schoolId || "").trim();
  if (!sid || !body) return;

  const payment = body.payment;
  if (payment && typeof payment === "object") {
    upsertPaymentFromApiResponse(sid, payment, undefined, { notify: false });
  }

  const ledgerEntries = body.ledgerEntries;
  if (Array.isArray(ledgerEntries) && ledgerEntries.length) {
    mergeLedgerEntriesSilent(
      sid,
      ledgerEntries.map((row) => mapApiRowToLedgerEntry(sid, row))
    );
  }

  const account = body.account;
  if (account && typeof account === "object") {
    patchStatementApiAccount(sid, account);
  } else {
    const statements = body.statements ?? body.accounts;
    if (Array.isArray(statements) && statements.length) {
      writeStatementApiAccounts(sid, statements);
      writeStatementApiSummaries(
        sid,
        statements.map((row: any) => ({
          accountNo: String(row.accountNo || ""),
          lastInvoice: Number.isFinite(Number(row.lastInvoice)) ? Number(row.lastInvoice) : 0,
          lastInvoiceDate: String(row.lastInvoiceDate || ""),
          lastInvoiceLabel: row.lastInvoiceLabel ?? null,
          lastPayment: Number.isFinite(Number(row.lastPayment)) ? Number(row.lastPayment) : 0,
          lastPaymentDate: String(row.lastPaymentDate || ""),
        }))
      );
    }
  }
  notifyBillingUpdated();
}

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

export type TransactionListExportRow = {
  date: string;
  type: string;
  accountNo: string;
  accountHolder: string;
  learners: string;
  description: string;
  reference: string;
  amount: number;
  source: string;
  createdAt: string;
};

export type TransactionListExportResponse = {
  rows: TransactionListExportRow[];
  generatedAt: string;
  fromDate: string;
  toDate: string;
  count: number;
  totalAmount: number;
};

function resolveTransactionListDateRange(config: {
  dateSelection: string;
  customFrom: string;
  customTo: string;
}): { fromDate: string; toDate: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const sel = String(config.dateSelection || "This Month");
  if (sel === "Today") {
    const d = iso(today);
    return { fromDate: d, toDate: d };
  }
  if (sel === "Last Month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { fromDate: iso(start), toDate: iso(end) };
  }
  if (sel === "Custom Dates") {
    return {
      fromDate: String(config.customFrom || "").slice(0, 10),
      toDate: String(config.customTo || "").slice(0, 10),
    };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { fromDate: iso(start), toDate: iso(end) };
}

function entryMatchesTransactionListType(type: string, filter: string): boolean {
  const t = String(type || "").toLowerCase();
  const f = String(filter || "All");
  if (f === "All") return true;
  if (f === "Payments") return t === "payment";
  if (f === "Invoices") return t === "invoice";
  if (f === "Credits") return t === "credit";
  if (f === "Penalties") return t === "penalty";
  return true;
}

/** Transaction list report — reads ledger + statement accounts (read-only). */
export async function fetchTransactionListExport(
  schoolId: string,
  config: {
    type: string;
    dateSelection: string;
    customFrom: string;
    customTo: string;
    hideCorrections: boolean;
  }
): Promise<TransactionListExportResponse> {
  const sid = String(schoolId || "").trim();
  const { fromDate, toDate } = resolveTransactionListDateRange(config);
  const [ledgerRows, statements] = await Promise.all([
    fetchLedger(sid),
    fetchStatements(sid),
  ]);

  const holderByAccount = new Map<string, string>();
  const learnersByAccount = new Map<string, string>();
  for (const row of statements) {
    const acct = String(row.accountNo || "").trim().toUpperCase();
    if (!acct) continue;
    holderByAccount.set(
      acct,
      String(row.accountHolder || row.familyName || row.name || acct)
    );
    const members = Array.isArray(row.memberNames)
      ? row.memberNames.join(" · ")
      : String(row.name || "");
    learnersByAccount.set(acct, members || "—");
  }

  const rows: TransactionListExportRow[] = [];
  let totalAmount = 0;

  for (const row of ledgerRows) {
    const source = String(row.source || "");
    if (config.hideCorrections) {
      if (source === "educlear_undo_correction" || String(row.id || "").startsWith("undo-corr-")) {
        continue;
      }
      if (row.undoneAt || row.statementHidden) continue;
    }
    const type = String(row.type || "invoice").toLowerCase();
    if (!entryMatchesTransactionListType(type, config.type)) continue;
    const date = String(row.date || row.createdAt || "").slice(0, 10);
    if (fromDate && date < fromDate) continue;
    if (toDate && date > toDate) continue;
    const accountNo = String(row.accountNo || "").trim().toUpperCase();
    const amount = Math.abs(Number(row.amount) || 0);
    totalAmount += amount;
    rows.push({
      date: date || "—",
      type: type.charAt(0).toUpperCase() + type.slice(1),
      accountNo: accountNo || "—",
      accountHolder: holderByAccount.get(accountNo) || accountNo || "—",
      learners: learnersByAccount.get(accountNo) || "—",
      description: String(row.description || "—"),
      reference: String(row.reference || "—"),
      amount,
      source: source || "—",
      createdAt: String(row.createdAt || "").slice(0, 19) || "—",
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.accountNo.localeCompare(b.accountNo));

  return {
    rows,
    generatedAt: new Date().toISOString(),
    fromDate,
    toDate,
    count: rows.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
  };
}
