export const SUPPLIER_INVOICES_STORAGE_PREFIX = "educlearAccountingSupplierInvoices:";
export const SUPPLIER_INVOICES_MIGRATED_FLAG = "educlearAccountingSupplierInvoicesMigrated:";
export const SUPPLIER_INVOICES_UPDATED_EVENT = "educlear-supplier-invoices-updated";

export type SupplierInvoiceStatus =
  | "Draft"
  | "Awaiting Approval"
  | "Approved"
  | "Part Paid"
  | "Paid"
  | "Disputed"
  | "Cancelled";

export type SupplierInvoiceCaptureMethod = "Manual" | "Upload" | "Banking Match";

export type SupplierInvoicePaymentRecord = {
  id: string;
  paymentDate: string;
  amount: number;
  reference: string;
  method: string;
  notes: string;
  bankTransactionId?: string;
  createdAt: string;
};

export type SupplierInvoice = {
  id: string;
  supplierId: string;
  supplierName: string;
  category: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  description: string;
  status: SupplierInvoiceStatus;
  captureMethod: SupplierInvoiceCaptureMethod;
  attachmentName: string;
  attachmentPreviewUrl: string;
  sourceBankTransactionId: string;
  approvedBy: string;
  approvedAt: string;
  paidAmount: number;
  balance: number;
  notes: string;
  payments: SupplierInvoicePaymentRecord[];
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
};

function storageKey(schoolId: string) {
  return SUPPLIER_INVOICES_STORAGE_PREFIX + schoolId;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function notifySupplierInvoicesUpdated(schoolId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SUPPLIER_INVOICES_UPDATED_EVENT, { detail: { schoolId } })
  );
  window.dispatchEvent(
    new CustomEvent("educlear-creditors-updated", { detail: { schoolId } })
  );
}

export function normaliseMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function loadSupplierInvoices(schoolId: string): SupplierInvoice[] {
  const rows = readJson<SupplierInvoice[]>(storageKey(schoolId), []);
  return Array.isArray(rows) ? rows : [];
}

export function saveSupplierInvoices(schoolId: string, rows: SupplierInvoice[]) {
  writeJson(storageKey(schoolId), rows);
  notifySupplierInvoicesUpdated(schoolId);
}

export function upsertSupplierInvoice(schoolId: string, invoice: SupplierInvoice) {
  const rows = loadSupplierInvoices(schoolId);
  const idx = rows.findIndex((r) => r.id === invoice.id);
  if (idx >= 0) rows[idx] = invoice;
  else rows.unshift(invoice);
  saveSupplierInvoices(schoolId, rows);
  return invoice;
}

export function getSupplierInvoiceById(schoolId: string, id: string): SupplierInvoice | null {
  return loadSupplierInvoices(schoolId).find((r) => r.id === id) || null;
}

export function isMigrationComplete(schoolId: string): boolean {
  return localStorage.getItem(SUPPLIER_INVOICES_MIGRATED_FLAG + schoolId) === "1";
}

export function markMigrationComplete(schoolId: string) {
  localStorage.setItem(SUPPLIER_INVOICES_MIGRATED_FLAG + schoolId, "1");
}
