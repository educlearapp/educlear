import { API_URL } from "../api";
import { mergeApiLedger, type BillingLedgerEntry } from "./billingLedger";

const parseArray = (data: any, keys: string[]) => {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

const getJson = async (url: string) => {
  const response = await fetch(url);
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

const postJson = async (url: string, data: any) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Billing API POST failed: ${url}`);
  return response.json();
};

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

export const fetchLedger = async (schoolId: string) => {
  const data = await getJson(`${API_URL}/api/invoices/ledger?schoolId=${encodeURIComponent(schoolId)}`);
  return parseArray(data, ["entries", "ledger", "items"]);
};

export const syncBillingLedgerFromApi = async (schoolId: string) => {
  const sid = String(schoolId || "").trim();
  if (!sid) return;

  const ledgerRows = await fetchLedger(sid);
  if (ledgerRows.length) {
    const entries: BillingLedgerEntry[] = ledgerRows.map((row: any) => ({
      id: String(row.id),
      schoolId: sid,
      learnerId: String(row.learnerId || ""),
      accountNo: String(row.accountNo || ""),
      type: (row.type || "invoice") as BillingLedgerEntry["type"],
      amount: Number(row.amount || 0),
      date: String(row.date || row.invoiceDate || row.paymentDate || "").slice(0, 10),
      dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : undefined,
      reference: String(row.reference || row.invoiceNumber || ""),
      description: String(row.description || row.type || "Entry"),
      method: row.method ? String(row.method) : undefined,
      runId: row.runId ? String(row.runId) : undefined,
      createdAt: String(row.createdAt || new Date().toISOString()),
    }));
    mergeApiLedger(sid, entries);
    return;
  }

  const [invoices, payments] = await Promise.all([fetchInvoices(sid), fetchPayments(sid)]);
  const entries: BillingLedgerEntry[] = [
    ...invoices.map((row: any) => ({
      id: String(row.id),
      schoolId: sid,
      learnerId: String(row.learnerId || ""),
      accountNo: String(row.accountNo || ""),
      type: "invoice" as const,
      amount: Number(row.amount || 0),
      date: String(row.invoiceDate || row.date || "").slice(0, 10),
      dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : undefined,
      reference: String(row.reference || row.invoiceNumber || ""),
      description: String(row.description || "Invoice"),
      runId: row.runId ? String(row.runId) : undefined,
      createdAt: String(row.createdAt || new Date().toISOString()),
    })),
    ...payments.map((row: any) => ({
      id: String(row.id),
      schoolId: sid,
      learnerId: String(row.learnerId || ""),
      accountNo: String(row.accountNo || ""),
      type: "payment" as const,
      amount: Number(row.amount || 0),
      date: String(row.paymentDate || row.date || "").slice(0, 10),
      reference: String(row.reference || ""),
      description: String(row.description || "Payment"),
      method: row.method ? String(row.method) : undefined,
      createdAt: String(row.createdAt || new Date().toISOString()),
    })),
  ];

  mergeApiLedger(sid, entries);
};

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

export const createInvoice = async (data: any) => postJson(`${API_URL}/api/invoices`, data);

export const createPayment = async (data: any) => postJson(`${API_URL}/api/payments`, data);
