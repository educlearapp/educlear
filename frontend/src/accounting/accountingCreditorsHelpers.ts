import { formatMoney } from "../billing/billingLedger";
import { loadSuppliersForMatching } from "../banking/bankingReconciliationUtils";
import { loadApprovedExpenses, type AccountingApprovedExpense } from "./accountingExpenseStorage";

export const CREDITOR_INVOICES_PREFIX = "educlearAccountingCreditorInvoices:";
export const CREDITOR_PAYMENT_PLANS_PREFIX = "educlearAccountingCreditorPaymentPlans:";
export const CREDITOR_NOTES_PREFIX = "educlearAccountingCreditorNotes:";
export const CREDITORS_UPDATED_EVENT = "educlear-creditors-updated";

export type CreditorInvoiceStatus = "Open" | "Paid" | "Disputed";
export type CreditorDisplayStatus =
  | "Current"
  | "Due Soon"
  | "Overdue"
  | "Payment Plan"
  | "Disputed"
  | "Closed / Paid";

export type CreditorNoteType = "Call" | "Email" | "Meeting" | "Promise" | "Internal Note";

export type AgeingBuckets = {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120Plus: number;
};

export type CreditorPaymentRecord = {
  id: string;
  paymentDate: string;
  amount: number;
  reference: string;
  method: string;
  notes: string;
  createdAt: string;
};

export type CreditorInvoice = {
  id: string;
  supplierId: string;
  supplierName: string;
  category: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  description: string;
  notes: string;
  status: CreditorInvoiceStatus;
  payments: CreditorPaymentRecord[];
  createdAt: string;
  updatedAt: string;
};

export type CreditorPaymentPlan = {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceId?: string;
  planAmount: number;
  startDate: string;
  endDate: string;
  installmentAmount: number;
  frequency: string;
  notes: string;
  status: "Active" | "Completed" | "Cancelled";
  createdAt: string;
};

export type CreditorNote = {
  id: string;
  date: string;
  type: CreditorNoteType;
  note: string;
  createdAt: string;
};

export type CreditorAgeingRow = {
  supplierId: string;
  supplierName: string;
  category: string;
  outstandingBalance: number;
  ageing: AgeingBuckets;
  displayStatus: CreditorDisplayStatus;
  nextDueDate: string;
  openInvoiceCount: number;
  disputedCount: number;
  hasActivePlan: boolean;
};

export type CreditorInvoiceLine = CreditorInvoice & {
  outstanding: number;
  ageing: AgeingBuckets;
  displayStatus: CreditorDisplayStatus;
};

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

function invoicesKey(schoolId: string) {
  return CREDITOR_INVOICES_PREFIX + schoolId;
}

function plansKey(schoolId: string) {
  return CREDITOR_PAYMENT_PLANS_PREFIX + schoolId;
}

function notesKey(schoolId: string) {
  return CREDITOR_NOTES_PREFIX + schoolId;
}

export function notifyCreditorsUpdated(schoolId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CREDITORS_UPDATED_EVENT, { detail: { schoolId } })
  );
}

export function normaliseCreditorAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function normaliseIsoDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = normaliseIsoDate(fromIso);
  const to = normaliseIsoDate(toIso);
  if (!from || !to) return 0;
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

export function supplierLookupKey(supplierId: string, supplierName: string) {
  const id = String(supplierId || "").trim();
  if (id) return id;
  return `name:${String(supplierName || "").trim().toLowerCase()}`;
}

export function noteStorageKey(supplierId: string, supplierName: string, invoiceId?: string) {
  const base = supplierLookupKey(supplierId, supplierName);
  const inv = String(invoiceId || "").trim();
  return inv ? `${base}::${inv}` : base;
}

export function loadCreditorInvoices(schoolId: string): CreditorInvoice[] {
  const rows = readJson<CreditorInvoice[]>(invoicesKey(schoolId), []);
  return Array.isArray(rows) ? rows : [];
}

export function saveCreditorInvoices(schoolId: string, rows: CreditorInvoice[]) {
  writeJson(invoicesKey(schoolId), rows);
  notifyCreditorsUpdated(schoolId);
}

export function loadCreditorPaymentPlans(schoolId: string): CreditorPaymentPlan[] {
  const rows = readJson<CreditorPaymentPlan[]>(plansKey(schoolId), []);
  return Array.isArray(rows) ? rows : [];
}

export function saveCreditorPaymentPlans(schoolId: string, rows: CreditorPaymentPlan[]) {
  writeJson(plansKey(schoolId), rows);
  notifyCreditorsUpdated(schoolId);
}

export function loadCreditorNotes(schoolId: string): Record<string, CreditorNote[]> {
  const data = readJson<Record<string, CreditorNote[]>>(notesKey(schoolId), {});
  return data && typeof data === "object" ? data : {};
}

export function saveCreditorNotes(schoolId: string, data: Record<string, CreditorNote[]>) {
  writeJson(notesKey(schoolId), data);
  notifyCreditorsUpdated(schoolId);
}

export function loadCreditorSuppliers(schoolId: string) {
  return loadSuppliersForMatching(schoolId);
}

export function invoiceAmountPaid(invoice: CreditorInvoice): number {
  return (invoice.payments || []).reduce(
    (sum, p) => sum + normaliseCreditorAmount(p.amount),
    0
  );
}

export function invoiceOutstanding(invoice: CreditorInvoice): number {
  if (invoice.status === "Paid") return 0;
  const paid = invoiceAmountPaid(invoice);
  const remaining = normaliseCreditorAmount(invoice.amount) - paid;
  return remaining > 0 ? Math.round(remaining * 100) / 100 : 0;
}

export function isPaymentPlanActive(plan: CreditorPaymentPlan | undefined, asOfDate: string): boolean {
  if (!plan || plan.status !== "Active") return false;
  const asOf = normaliseIsoDate(asOfDate);
  const start = normaliseIsoDate(plan.startDate);
  const end = normaliseIsoDate(plan.endDate);
  if (!asOf || !start || !end) return false;
  return start <= asOf && end >= asOf;
}

export function getActivePaymentPlan(
  plans: CreditorPaymentPlan[],
  supplierId: string,
  supplierName: string,
  asOfDate: string
) {
  const key = supplierLookupKey(supplierId, supplierName);
  return plans.find(
    (p) =>
      supplierLookupKey(p.supplierId, p.supplierName) === key &&
      isPaymentPlanActive(p, asOfDate)
  );
}

export function allocateOutstandingToAgeingBucket(
  outstanding: number,
  dueDate: string,
  asOfDate: string
): AgeingBuckets {
  const buckets: AgeingBuckets = {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    days120Plus: 0,
  };
  const amount = normaliseCreditorAmount(outstanding);
  if (amount <= 0) return buckets;

  const due = normaliseIsoDate(dueDate);
  const asOf = normaliseIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);
  if (!due) {
    buckets.current += amount;
    return buckets;
  }

  const daysOverdue = daysBetweenIso(due, asOf);
  if (daysOverdue <= 0) buckets.current += amount;
  else if (daysOverdue <= 30) buckets.days30 += amount;
  else if (daysOverdue <= 60) buckets.days60 += amount;
  else if (daysOverdue <= 90) buckets.days90 += amount;
  else buckets.days120Plus += amount;

  return buckets;
}

export function sumAgeingBuckets(rows: { ageing: AgeingBuckets }[]): AgeingBuckets {
  return rows.reduce(
    (acc, row) => ({
      current: acc.current + row.ageing.current,
      days30: acc.days30 + row.ageing.days30,
      days60: acc.days60 + row.ageing.days60,
      days90: acc.days90 + row.ageing.days90,
      days120Plus: acc.days120Plus + row.ageing.days120Plus,
    }),
    { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 }
  );
}

export function resolveInvoiceDisplayStatus(
  invoice: CreditorInvoice,
  asOfDate: string,
  hasActivePlan: boolean
): CreditorDisplayStatus {
  const outstanding = invoiceOutstanding(invoice);
  if (outstanding <= 0) return "Closed / Paid";
  if (hasActivePlan) return "Payment Plan";
  if (invoice.status === "Disputed") return "Disputed";
  const due = normaliseIsoDate(invoice.dueDate);
  const asOf = normaliseIsoDate(asOfDate);
  if (due && asOf && due < asOf) return "Overdue";
  if (due && asOf) {
    const daysUntil = daysBetweenIso(asOf, due);
    if (daysUntil >= 0 && daysUntil <= 14) return "Due Soon";
  }
  return "Current";
}

export function resolveSupplierDisplayStatus(input: {
  outstanding: number;
  hasDisputed: boolean;
  hasOverdue: boolean;
  hasDueSoon: boolean;
  hasActivePlan: boolean;
}): CreditorDisplayStatus {
  if (input.outstanding <= 0 && !input.hasActivePlan) return "Closed / Paid";
  if (input.hasActivePlan) return "Payment Plan";
  if (input.hasDisputed) return "Disputed";
  if (input.hasOverdue) return "Overdue";
  if (input.hasDueSoon) return "Due Soon";
  if (input.outstanding > 0) return "Current";
  return "Closed / Paid";
}

export function creditorStatusColor(status: CreditorDisplayStatus): {
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case "Current":
      return { bg: "#ecfdf5", text: "#047857", border: "#6ee7b7" };
    case "Due Soon":
      return { bg: "#fffbeb", text: "#b45309", border: "#fcd34d" };
    case "Overdue":
      return { bg: "#fef2f2", text: "#b91c1c", border: "#fca5a5" };
    case "Payment Plan":
      return { bg: "#f5f3ff", text: "#6d28d9", border: "#c4b5fd" };
    case "Disputed":
      return { bg: "#fff7ed", text: "#c2410c", border: "#fdba74" };
    case "Closed / Paid":
    default:
      return { bg: "#f8fafc", text: "#475569", border: "#e2e8f0" };
  }
}

export function resolveAsOfDate(year: number, monthIndex: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(year, monthIndex + 1, 0).toISOString().slice(0, 10);
  return end > today ? today : end;
}

export function isDueInMonth(dueDate: string, year: number, monthIndex: number): boolean {
  const due = normaliseIsoDate(dueDate);
  if (!due) return false;
  const [y, m] = due.split("-").map(Number);
  return y === year && m - 1 === monthIndex;
}

export function buildCreditorInvoiceLines(
  invoices: CreditorInvoice[],
  plans: CreditorPaymentPlan[],
  asOfDate: string
): CreditorInvoiceLine[] {
  return invoices.map((invoice) => {
    const plan = getActivePaymentPlan(
      plans,
      invoice.supplierId,
      invoice.supplierName,
      asOfDate
    );
    const outstanding = invoiceOutstanding(invoice);
    const ageing = allocateOutstandingToAgeingBucket(outstanding, invoice.dueDate, asOfDate);
    const displayStatus = resolveInvoiceDisplayStatus(invoice, asOfDate, Boolean(plan));
    return { ...invoice, outstanding, ageing, displayStatus };
  });
}

export function buildCreditorAgeingRows(input: {
  invoices: CreditorInvoice[];
  plans: CreditorPaymentPlan[];
  asOfDate: string;
}): CreditorAgeingRow[] {
  const lines = buildCreditorInvoiceLines(input.invoices, input.plans, input.asOfDate);
  const openLines = lines.filter((l) => l.outstanding > 0 || l.status === "Disputed");

  const bySupplier = new Map<string, CreditorAgeingRow>();

  for (const line of openLines) {
    const key = supplierLookupKey(line.supplierId, line.supplierName);
    let row = bySupplier.get(key);
    if (!row) {
      row = {
        supplierId: line.supplierId,
        supplierName: line.supplierName,
        category: line.category || "Other",
        outstandingBalance: 0,
        ageing: { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 },
        displayStatus: "Current",
        nextDueDate: "",
        openInvoiceCount: 0,
        disputedCount: 0,
        hasActivePlan: false,
      };
      bySupplier.set(key, row);
    }

    row.outstandingBalance += line.outstanding;
    row.ageing.current += line.ageing.current;
    row.ageing.days30 += line.ageing.days30;
    row.ageing.days60 += line.ageing.days60;
    row.ageing.days90 += line.ageing.days90;
    row.ageing.days120Plus += line.ageing.days120Plus;
    if (line.outstanding > 0) row.openInvoiceCount += 1;
    if (line.status === "Disputed") row.disputedCount += 1;
    if (!line.category && row.category === "Other") row.category = line.category || "Other";
    if (line.category && row.category === "Other") row.category = line.category;

    const due = normaliseIsoDate(line.dueDate);
    if (due && line.outstanding > 0) {
      if (!row.nextDueDate || due < row.nextDueDate) row.nextDueDate = due;
    }
  }

  for (const plan of input.plans) {
    if (!isPaymentPlanActive(plan, input.asOfDate)) continue;
    const key = supplierLookupKey(plan.supplierId, plan.supplierName);
    let row = bySupplier.get(key);
    if (!row) {
      row = {
        supplierId: plan.supplierId,
        supplierName: plan.supplierName,
        category: "Other",
        outstandingBalance: 0,
        ageing: { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 },
        displayStatus: "Payment Plan",
        nextDueDate: normaliseIsoDate(plan.endDate),
        openInvoiceCount: 0,
        disputedCount: 0,
        hasActivePlan: true,
      };
      bySupplier.set(key, row);
    }
    row.hasActivePlan = true;
  }

  const result: CreditorAgeingRow[] = [];
  for (const row of bySupplier.values()) {
    row.outstandingBalance = normaliseCreditorAmount(row.outstandingBalance);
    const supplierLines = openLines.filter(
      (l) => supplierLookupKey(l.supplierId, l.supplierName) === supplierLookupKey(row.supplierId, row.supplierName)
    );
    const hasDisputed = supplierLines.some((l) => l.status === "Disputed" && l.outstanding > 0);
    const hasOverdue = supplierLines.some((l) => l.displayStatus === "Overdue");
    const hasDueSoon = supplierLines.some((l) => l.displayStatus === "Due Soon");
    row.displayStatus = resolveSupplierDisplayStatus({
      outstanding: row.outstandingBalance,
      hasDisputed,
      hasOverdue,
      hasDueSoon,
      hasActivePlan: row.hasActivePlan,
    });
    result.push(row);
  }

  return result.sort((a, b) => b.outstandingBalance - a.outstandingBalance);
}

export function applyPaymentToInvoice(
  invoice: CreditorInvoice,
  payment: Omit<CreditorPaymentRecord, "id" | "createdAt">
): CreditorInvoice {
  const record: CreditorPaymentRecord = {
    id: `cpay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    paymentDate: normaliseIsoDate(payment.paymentDate) || new Date().toISOString().slice(0, 10),
    amount: normaliseCreditorAmount(payment.amount),
    reference: String(payment.reference || "").trim(),
    method: String(payment.method || "").trim(),
    notes: String(payment.notes || "").trim(),
  };
  const payments = [...(invoice.payments || []), record];
  const outstanding = normaliseCreditorAmount(invoice.amount) - payments.reduce((s, p) => s + p.amount, 0);
  const status: CreditorInvoiceStatus =
    outstanding <= 0.009 ? "Paid" : invoice.status === "Disputed" ? "Disputed" : "Open";
  return {
    ...invoice,
    payments,
    status,
    updatedAt: new Date().toISOString(),
  };
}

export function supplierApprovedSpend(
  schoolId: string,
  supplierId: string,
  supplierName: string
): AccountingApprovedExpense[] {
  const approved = loadApprovedExpenses(schoolId);
  const nameKey = String(supplierName || "").trim().toLowerCase();
  return approved.filter((row) => {
    const rowName = String(row.supplier || "").trim().toLowerCase();
    if (supplierId && rowName === nameKey) return true;
    return rowName === nameKey;
  });
}

export type CreditorTotals = {
  asAtDate: string;
  supplierPayables: number;
  overdueSupplierPayables: number;
  paymentPlanCommitments: number;
  openInvoiceCount: number;
  overdueInvoiceCount: number;
  disputedCount: number;
  supplierCount: number;
  ageing: AgeingBuckets;
};

export type UpcomingSupplierPayments = {
  asAtDate: string;
  startDate: string;
  endDate: string;
  scheduledInvoicePayments: number;
  paymentPlanInstallments: number;
  totalUpcoming: number;
};

export type CreditorReportingPeriod = {
  startDate: string;
  endDate: string;
  year?: number;
  monthIndex?: number;
};

/** Supplier liabilities as at period end (Creditors Ageing source). */
import { loadCreditorInvoicesUnified } from "./supplierInvoiceCreditorBridge";

export { loadCreditorInvoicesUnified };

function loadCreditorInvoicesForReporting(schoolId: string): CreditorInvoice[] {
  return loadCreditorInvoicesUnified(schoolId);
}

export function calculateCreditorTotals(schoolId: string, asAtDate: string): CreditorTotals {
  const asOf = normaliseIsoDate(asAtDate) || new Date().toISOString().slice(0, 10);
  const invoices = loadCreditorInvoicesForReporting(schoolId);
  const plans = loadCreditorPaymentPlans(schoolId);
  const ageingRows = buildCreditorAgeingRows({ invoices, plans, asOfDate: asOf });
  const lines = buildCreditorInvoiceLines(invoices, plans, asOf);

  const supplierPayables = normaliseCreditorAmount(
    ageingRows.reduce((sum, row) => sum + row.outstandingBalance, 0)
  );
  const overdueSupplierPayables = normaliseCreditorAmount(
    lines
      .filter((line) => line.outstanding > 0 && line.displayStatus === "Overdue")
      .reduce((sum, line) => sum + line.outstanding, 0)
  );
  const paymentPlanCommitments = normaliseCreditorAmount(
    plans
      .filter((plan) => isPaymentPlanActive(plan, asOf))
      .reduce((sum, plan) => sum + normaliseCreditorAmount(plan.installmentAmount), 0)
  );

  return {
    asAtDate: asOf,
    supplierPayables,
    overdueSupplierPayables,
    paymentPlanCommitments,
    openInvoiceCount: lines.filter((line) => line.outstanding > 0).length,
    overdueInvoiceCount: lines.filter(
      (line) => line.outstanding > 0 && line.displayStatus === "Overdue"
    ).length,
    disputedCount: lines.filter((line) => line.status === "Disputed" && line.outstanding > 0).length,
    supplierCount: ageingRows.filter((row) => row.outstandingBalance > 0 || row.hasActivePlan).length,
    ageing: sumAgeingBuckets(ageingRows),
  };
}

/** Supplier ageing rows as at date (same as Creditors Ageing). */
export function calculateCreditorAgeing(schoolId: string, asAtDate: string): CreditorAgeingRow[] {
  const asOf = normaliseIsoDate(asAtDate) || new Date().toISOString().slice(0, 10);
  return buildCreditorAgeingRows({
    invoices: loadCreditorInvoicesForReporting(schoolId),
    plans: loadCreditorPaymentPlans(schoolId),
    asOfDate: asOf,
  });
}

/** Open invoices and active plan installments due within the reporting period. */
export function calculateUpcomingSupplierPayments(
  schoolId: string,
  period: CreditorReportingPeriod
): UpcomingSupplierPayments {
  const startDate = normaliseIsoDate(period.startDate) || period.startDate;
  const endDate = normaliseIsoDate(period.endDate) || period.endDate;
  const invoices = loadCreditorInvoicesForReporting(schoolId);
  const plans = loadCreditorPaymentPlans(schoolId);

  let scheduledInvoicePayments = 0;
  for (const invoice of invoices) {
    const outstanding = invoiceOutstanding(invoice);
    if (outstanding <= 0) continue;
    const due = normaliseIsoDate(invoice.dueDate);
    if (!due) continue;
    if (due >= startDate && due <= endDate) {
      scheduledInvoicePayments += outstanding;
    } else if (
      period.year !== undefined &&
      period.monthIndex !== undefined &&
      isDueInMonth(due, period.year, period.monthIndex)
    ) {
      scheduledInvoicePayments += outstanding;
    }
  }

  let paymentPlanInstallments = 0;
  for (const plan of plans) {
    if (!isPaymentPlanActive(plan, endDate)) continue;
    const planStart = normaliseIsoDate(plan.startDate);
    const planEnd = normaliseIsoDate(plan.endDate);
    if (planStart && planEnd && planEnd >= startDate && planStart <= endDate) {
      paymentPlanInstallments += normaliseCreditorAmount(plan.installmentAmount);
    }
  }

  scheduledInvoicePayments = normaliseCreditorAmount(scheduledInvoicePayments);
  paymentPlanInstallments = normaliseCreditorAmount(paymentPlanInstallments);

  return {
    asAtDate: endDate,
    startDate,
    endDate,
    scheduledInvoicePayments,
    paymentPlanInstallments,
    totalUpcoming: normaliseCreditorAmount(scheduledInvoicePayments + paymentPlanInstallments),
  };
}

export function listTopCreditors(
  schoolId: string,
  asAtDate: string,
  limit = 10
): CreditorAgeingRow[] {
  return calculateCreditorAgeing(schoolId, asAtDate).slice(0, limit);
}

export function creditorTotalsForReportingPeriod(
  schoolId: string,
  period: { endDate: string; year: number; monthIndex: number }
): CreditorTotals {
  const asAt =
    normaliseIsoDate(period.endDate) || resolveAsOfDate(period.year, period.monthIndex);
  return calculateCreditorTotals(schoolId, asAt);
}

export function upcomingCreditorPaymentsForReportingPeriod(
  schoolId: string,
  period: { startDate: string; endDate: string; year: number; monthIndex: number }
): UpcomingSupplierPayments {
  return calculateUpcomingSupplierPayments(schoolId, {
    startDate: period.startDate,
    endDate: period.endDate,
    year: period.year,
    monthIndex: period.monthIndex,
  });
}

export { formatMoney };
