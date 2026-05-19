import { API_URL } from "../api";

const BASE = `${API_URL}/api/accounting`;

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { error?: string })?.error || `Request failed (${res.status})`));
  }
  if ((data as { success?: boolean }).success === false) {
    throw new Error(String((data as { error?: string }).error || "Request failed"));
  }
  return data;
}

export type ApiSupplier = {
  id: string;
  schoolId: string;
  supplierName: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  vatNumber: string;
  address: string;
  status: "Active" | "Inactive";
  outstandingBalance: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiExpenseCategory = {
  id: string;
  schoolId: string;
  name: string;
  code: string;
};

export type ApiInvoiceLine = {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  expenseCategoryId?: string | null;
  expenseCategoryName?: string;
};

export type ApiSupplierInvoice = {
  id: string;
  schoolId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  outstandingAmount: number;
  amount: number;
  status: "pending" | "approved" | "partially_paid" | "paid";
  statusLabel: string;
  notes: string;
  linkedBankTransactionId: string | null;
  lines: ApiInvoiceLine[];
  payments: Array<{
    id: string;
    paymentDate: string;
    amount: number;
    reference: string;
    method: string;
    notes: string;
    bankTransactionId?: string | null;
    createdAt: string;
  }>;
  paidAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiJournal = {
  id: string;
  journalNo: string;
  date: string;
  description: string;
  reference: string;
  notes: string;
  status: string;
  sourceModule?: string | null;
  sourceId?: string | null;
  sourceFingerprint?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lines: Array<{
    id: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    memo: string;
  }>;
};

export type CreditorsAgeingRow = {
  supplierId: string;
  supplierName: string;
  current: number;
  days30: number;
  days60: number;
  days90plus: number;
  total: number;
};

export async function fetchSuppliers(
  schoolId: string,
  opts?: { search?: string; status?: string; page?: number; pageSize?: number }
) {
  const params = new URLSearchParams({ schoolId });
  if (opts?.search) params.set("search", opts.search);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
  const res = await fetch(`${BASE}/suppliers?${params}`);
  return parseJson(res) as Promise<{
    success: boolean;
    suppliers: ApiSupplier[];
    page: number;
    totalPages: number;
    totalItems: number;
  }>;
}

export async function createSupplier(
  schoolId: string,
  body: Partial<ApiSupplier> & { supplierName: string }
) {
  const res = await fetch(`${BASE}/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId, ...body }),
  });
  return parseJson(res) as Promise<{ success: boolean; supplier: ApiSupplier }>;
}

export async function updateSupplier(
  schoolId: string,
  id: string,
  body: Partial<ApiSupplier>
) {
  const res = await fetch(`${BASE}/suppliers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId, ...body }),
  });
  return parseJson(res) as Promise<{ success: boolean; supplier: ApiSupplier }>;
}

export async function fetchExpenseCategories(schoolId: string) {
  const res = await fetch(`${BASE}/expense-categories?schoolId=${encodeURIComponent(schoolId)}`);
  return parseJson(res) as Promise<{ success: boolean; categories: ApiExpenseCategory[] }>;
}

export async function fetchSupplierInvoices(
  schoolId: string,
  opts?: { search?: string; status?: string; supplierId?: string; page?: number; pageSize?: number }
) {
  const params = new URLSearchParams({ schoolId });
  if (opts?.search) params.set("search", opts.search);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.supplierId) params.set("supplierId", opts.supplierId);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
  const res = await fetch(`${BASE}/supplier-invoices?${params}`);
  return parseJson(res) as Promise<{
    success: boolean;
    invoices: ApiSupplierInvoice[];
    page: number;
    totalPages: number;
    totalItems: number;
  }>;
}

export async function fetchOpenSupplierInvoices(schoolId: string) {
  const res = await fetch(`${BASE}/supplier-invoices/open?schoolId=${encodeURIComponent(schoolId)}`);
  return parseJson(res) as Promise<{ success: boolean; invoices: ApiSupplierInvoice[] }>;
}

export async function createSupplierInvoice(
  schoolId: string,
  body: {
    supplierId: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    subtotal?: number;
    vatAmount: number;
    totalAmount: number;
    notes?: string;
    lines?: ApiInvoiceLine[];
    autoApprove?: boolean;
  }
) {
  const res = await fetch(`${BASE}/supplier-invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId, ...body }),
  });
  return parseJson(res) as Promise<{ success: boolean; invoice: ApiSupplierInvoice; journal?: ApiJournal | null }>;
}

export async function approveSupplierInvoice(schoolId: string, invoiceId: string) {
  const res = await fetch(`${BASE}/supplier-invoices/${invoiceId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId }),
  });
  return parseJson(res) as Promise<{
    success: boolean;
    invoice: ApiSupplierInvoice;
    journal?: ApiJournal | null;
  }>;
}

export async function acceptBankSupplierMatch(body: {
  schoolId: string;
  invoiceId: string;
  bankTransactionId: string;
  amount: number;
  paymentDate: string;
  reference?: string;
}) {
  const res = await fetch(`${BASE}/bank-match/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res) as Promise<{
    success: boolean;
    invoice: ApiSupplierInvoice;
    journal?: ApiJournal | null;
  }>;
}

export async function fetchBankMatchSuggestions(
  schoolId: string,
  description: string,
  reference: string,
  amount: number
) {
  const params = new URLSearchParams({
    schoolId,
    description,
    reference,
    amount: String(amount),
  });
  const res = await fetch(`${BASE}/bank-match/suggestions?${params}`);
  return parseJson(res) as Promise<{
    success: boolean;
    best: {
      invoiceId: string;
      invoiceNumber: string;
      supplierId: string;
      supplierName: string;
      score: number;
      reason: string;
    } | null;
    suggestions: Array<{
      invoiceId: string;
      invoiceNumber: string;
      supplierId: string;
      supplierName: string;
      score: number;
      reason: string;
    }>;
  }>;
}

export async function postSupplierInvoicePayment(
  schoolId: string,
  invoiceId: string,
  body: {
    amount: number;
    paymentDate: string;
    reference?: string;
    method?: string;
    notes?: string;
    bankTransactionId?: string;
  }
) {
  const res = await fetch(`${BASE}/supplier-invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId, ...body }),
  });
  return parseJson(res) as Promise<{
    success: boolean;
    invoice: ApiSupplierInvoice;
    journal?: ApiJournal | null;
  }>;
}

export async function fetchCreditorsAgeing(
  schoolId: string,
  opts?: { search?: string; asOf?: string; page?: number; pageSize?: number }
) {
  const params = new URLSearchParams({ schoolId });
  if (opts?.search) params.set("search", opts.search);
  if (opts?.asOf) params.set("asOf", opts.asOf);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
  const res = await fetch(`${BASE}/creditors-ageing?${params}`);
  return parseJson(res) as Promise<{
    success: boolean;
    rows: CreditorsAgeingRow[];
    totals: CreditorsAgeingRow;
    asOf: string;
    page: number;
    totalPages: number;
    totalItems: number;
  }>;
}

export async function fetchAccountingJournals(schoolId: string) {
  const res = await fetch(`${BASE}/journals?schoolId=${encodeURIComponent(schoolId)}`);
  return parseJson(res) as Promise<{ success: boolean; journals: ApiJournal[] }>;
}

/** Merge API journals into local journal store for financial statements. */
export function mergeJournalsIntoLocalStore(schoolId: string, journals: ApiJournal[]) {
  if (!schoolId || !journals.length) return;
  try {
    const key = `educlearAccountingJournals:${schoolId}`;
    const raw = localStorage.getItem(key);
    const store = raw ? JSON.parse(raw) : { journals: [], audit: [] };
    const existing = Array.isArray(store.journals) ? store.journals : [];
    const fpSet = new Set(
      existing.map((j: { sourceFingerprint?: string }) => String(j.sourceFingerprint || ""))
    );
    for (const j of journals) {
      const fp = String(j.sourceFingerprint || "");
      if (fp && fpSet.has(fp)) continue;
      existing.unshift({
        id: j.id,
        journalNo: j.journalNo,
        date: j.date,
        description: j.description,
        reference: j.reference,
        notes: j.notes,
        status: j.status,
        lines: j.lines,
        createdBy: j.createdBy,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        origin: "AUTO",
        sourceModule: j.sourceModule || "Suppliers",
        sourceId: j.sourceId || "",
        sourceFingerprint: fp,
        autoGenerated: true,
      });
      if (fp) fpSet.add(fp);
    }
    localStorage.setItem(key, JSON.stringify({ ...store, journals: existing }));
    window.dispatchEvent(new CustomEvent("educlear-accounting-journals-updated", { detail: { schoolId } }));
  } catch {
    /* ignore */
  }
}
