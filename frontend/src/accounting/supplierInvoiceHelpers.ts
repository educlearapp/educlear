import { appendAuditTrailEntry } from "./accountingAuditComplianceStorage";
import {
  getExpenseDebitAccountCode,
  applyDescriptionTemplate,
  getRule,
} from "./accountingAutoPostingRules";
import {
  buildSourceFingerprint,
  createAutoJournal,
  createJournalLine,
  type AutoJournalResult,
} from "./accountingJournalEngine";
import { loadActiveCoaAccounts } from "./accountingJournalStorage";
import type { CreditorInvoice, CreditorPaymentRecord } from "./accountingCreditorsHelpers";
import {
  isMigrationComplete,
  loadSupplierInvoices,
  markMigrationComplete,
  normaliseMoney,
  saveSupplierInvoices,
  upsertSupplierInvoice,
  type SupplierInvoice,
  type SupplierInvoiceCaptureMethod,
  type SupplierInvoicePaymentRecord,
  type SupplierInvoiceStatus,
} from "./supplierInvoiceStorage";

const LEGACY_CREDITOR_INVOICES_PREFIX = "educlearAccountingCreditorInvoices:";

export { normaliseMoney };

const ACCOUNTS_PAYABLE_CODE = "2000";

function resolveCoa(schoolId: string, code: string) {
  const account = loadActiveCoaAccounts(schoolId).find((a) => a.code === code);
  return account ? { code: account.code, name: account.name } : null;
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function buildInvoiceFingerprint(input: {
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
}) {
  return [
    String(input.supplierId || "").trim(),
    String(input.invoiceNumber || "").trim().toLowerCase(),
    normaliseIsoDate(input.invoiceDate),
    String(normaliseMoney(input.totalAmount)),
  ].join("::");
}

export function recalcInvoiceBalances(invoice: SupplierInvoice): SupplierInvoice {
  const paidAmount = (invoice.payments || []).reduce(
    (s, p) => s + normaliseMoney(p.amount),
    0
  );
  const totalAmount = normaliseMoney(invoice.totalAmount);
  const balance = Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100);
  let status = invoice.status;

  if (status === "Cancelled" || status === "Draft" || status === "Awaiting Approval") {
    return { ...invoice, paidAmount, balance: status === "Cancelled" ? 0 : totalAmount };
  }

  if (status === "Disputed") {
    return { ...invoice, paidAmount, balance };
  }

  if (balance <= 0.009) {
    status = "Paid";
  } else if (paidAmount > 0 && (status === "Approved" || status === "Part Paid" || status === "Paid")) {
    status = "Part Paid";
  }

  return { ...invoice, paidAmount, balance, status };
}

export function normaliseIsoDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function legacyCreditorInvoicesKey(schoolId: string) {
  return LEGACY_CREDITOR_INVOICES_PREFIX + schoolId;
}

/** One-time import from educlearAccountingCreditorInvoices without duplicating fingerprints. */
export function migrateLegacyCreditorInvoices(schoolId: string): number {
  if (!schoolId || isMigrationComplete(schoolId)) return 0;
  try {
    const raw = localStorage.getItem(legacyCreditorInvoicesKey(schoolId));
    if (!raw) {
      markMigrationComplete(schoolId);
      return 0;
    }
    const legacy = JSON.parse(raw) as CreditorInvoice[];
    if (!Array.isArray(legacy) || !legacy.length) {
      markMigrationComplete(schoolId);
      return 0;
    }

    const existing = loadSupplierInvoices(schoolId);
    const fpSet = new Set(existing.map((r) => r.fingerprint));
    let imported = 0;

    for (const row of legacy) {
      const total = normaliseMoney(row.amount);
      if (total <= 0) continue;
      const fp = buildInvoiceFingerprint({
        supplierId: row.supplierId,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate,
        totalAmount: total,
      });
      if (fpSet.has(fp)) continue;

      const payments: SupplierInvoicePaymentRecord[] = (row.payments || []).map((p) => ({
        id: p.id || uid("spay"),
        paymentDate: normaliseIsoDate(p.paymentDate) || row.invoiceDate,
        amount: normaliseMoney(p.amount),
        reference: p.reference || "",
        method: p.method || "EFT",
        notes: p.notes || "",
        createdAt: p.createdAt || new Date().toISOString(),
      }));

      let status: SupplierInvoiceStatus = "Approved";
      if (row.status === "Disputed") status = "Disputed";
      if (row.status === "Paid" || payments.reduce((s, p) => s + p.amount, 0) >= total - 0.01) {
        status = "Paid";
      } else if (payments.length > 0) {
        status = "Part Paid";
      }

      const inv: SupplierInvoice = recalcInvoiceBalances({
        id: row.id || uid("sinv"),
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        category: row.category || "Other",
        invoiceNumber: row.invoiceNumber || "",
        invoiceDate: normaliseIsoDate(row.invoiceDate),
        dueDate: normaliseIsoDate(row.dueDate) || normaliseIsoDate(row.invoiceDate),
        amount: total,
        vatAmount: 0,
        totalAmount: total,
        description: row.description || "",
        status,
        captureMethod: "Manual",
        attachmentName: "",
        attachmentPreviewUrl: "",
        sourceBankTransactionId: "",
        approvedBy: "Migration",
        approvedAt: row.updatedAt || row.createdAt || new Date().toISOString(),
        paidAmount: 0,
        balance: total,
        notes: row.notes || "",
        payments,
        fingerprint: fp,
        createdAt: row.createdAt || new Date().toISOString(),
        updatedAt: row.updatedAt || new Date().toISOString(),
      });

      existing.push(inv);
      fpSet.add(fp);
      imported += 1;
    }

    if (imported) saveSupplierInvoices(schoolId, existing);
    markMigrationComplete(schoolId);
    return imported;
  } catch {
    markMigrationComplete(schoolId);
    return 0;
  }
}

export function supplierInvoiceToCreditor(invoice: SupplierInvoice): CreditorInvoice {
  const creditorStatus: CreditorInvoice["status"] =
    invoice.status === "Paid"
      ? "Paid"
      : invoice.status === "Disputed"
        ? "Disputed"
        : "Open";

  const payments: CreditorPaymentRecord[] = (invoice.payments || []).map((p) => ({
    id: p.id,
    paymentDate: p.paymentDate,
    amount: p.amount,
    reference: p.reference,
    method: p.method,
    notes: p.notes,
    createdAt: p.createdAt,
  }));

  return {
    id: invoice.id,
    supplierId: invoice.supplierId,
    supplierName: invoice.supplierName,
    category: invoice.category,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    amount: invoice.totalAmount,
    description: invoice.description,
    notes: invoice.notes,
    status: creditorStatus,
    payments,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

export function loadSupplierInvoicesForAgeing(schoolId: string): SupplierInvoice[] {
  migrateLegacyCreditorInvoices(schoolId);
  return loadSupplierInvoices(schoolId).filter((inv) => inv.status !== "Cancelled");
}

export function loadCreditorInvoicesFromEngine(schoolId: string): CreditorInvoice[] {
  return loadSupplierInvoicesForAgeing(schoolId)
    .filter((inv) => inv.status !== "Draft" && inv.status !== "Awaiting Approval")
    .map(supplierInvoiceToCreditor);
}

export function recordSupplierInvoiceAudit(
  schoolId: string,
  action: string,
  reference: string,
  details: string,
  user = "Finance User"
) {
  appendAuditTrailEntry(schoolId, {
    user,
    module: "Suppliers",
    action,
    reference,
    details,
    sourceKey: reference,
  });
}

export function postSupplierInvoiceApprovalJournal(input: {
  schoolId: string;
  invoice: SupplierInvoice;
  createdBy?: string;
}): AutoJournalResult {
  const { schoolId, invoice } = input;
  const amount = normaliseMoney(invoice.totalAmount);
  if (amount <= 0) {
    return { ok: false, skipped: true, reason: "Invoice amount is zero" };
  }

  const debitCode = getExpenseDebitAccountCode(invoice.category);
  const creditCode = ACCOUNTS_PAYABLE_CODE;
  const debitAcct = resolveCoa(schoolId, debitCode);
  const creditAcct = resolveCoa(schoolId, creditCode);
  if (!debitAcct || !creditAcct) {
    return { ok: false, skipped: true, reason: "Required COA accounts missing for supplier invoice" };
  }

  const fingerprint = buildSourceFingerprint({
    sourceType: "supplier_invoice_approval",
    sourceId: invoice.id,
    amount,
    date: invoice.invoiceDate,
  });

  const description = `Supplier invoice approved — ${invoice.supplierName} — ${invoice.invoiceNumber || invoice.id}`;

  return createAutoJournal({
    schoolId,
    date: invoice.invoiceDate,
    description,
    reference: invoice.invoiceNumber || invoice.id,
    notes: "Expense recognition on supplier invoice approval (not cash)",
    sourceModule: "Suppliers",
    sourceId: invoice.id,
    sourceFingerprint: fingerprint,
    createdBy: input.createdBy || "Suppliers",
    lines: [
      createJournalLine({
        accountCode: debitAcct.code,
        accountName: debitAcct.name,
        debit: amount,
        memo: invoice.category,
      }),
      createJournalLine({
        accountCode: creditAcct.code,
        accountName: creditAcct.name,
        credit: amount,
        memo: "Accounts payable",
      }),
    ],
  });
}

export function postSupplierInvoicePaymentJournal(input: {
  schoolId: string;
  invoice: SupplierInvoice;
  payment: SupplierInvoicePaymentRecord;
  createdBy?: string;
}): AutoJournalResult {
  const amount = normaliseMoney(input.payment.amount);
  if (amount <= 0) {
    return { ok: false, skipped: true, reason: "Payment amount is zero" };
  }

  const rule = getRule("supplier_payment");
  if (!rule?.enabled) {
    return postSupplierPaymentJournalDirect(input);
  }

  const reference = String(input.payment.reference || input.invoice.invoiceNumber || "").trim();
  return postFromSupplierPaymentRule(input.schoolId, {
    sourceId: `${input.invoice.id}::${input.payment.id}`,
    amount,
    date: input.payment.paymentDate,
    reference,
    supplierName: input.invoice.supplierName,
    createdBy: input.createdBy,
  });
}

function postFromSupplierPaymentRule(
  schoolId: string,
  input: {
    sourceId: string;
    amount: number;
    date: string;
    reference: string;
    supplierName: string;
    createdBy?: string;
  }
): AutoJournalResult {
  const rule = getRule("supplier_payment");
  if (!rule?.enabled) return postSupplierPaymentJournalDirect({ schoolId, ...input } as any);

  const debitAcct = resolveCoa(schoolId, rule.debitAccountCode);
  const creditAcct = resolveCoa(schoolId, rule.creditAccountCode);
  if (!debitAcct || !creditAcct) {
    return { ok: false, skipped: true, reason: "Supplier payment COA accounts missing" };
  }

  const fingerprint = buildSourceFingerprint({
    sourceType: "supplier_payment",
    sourceId: input.sourceId,
    amount: input.amount,
    date: input.date,
  });

  const description = applyDescriptionTemplate(rule.descriptionTemplate, {
    reference: input.reference,
    supplier: input.supplierName,
  });

  return createAutoJournal({
    schoolId,
    date: input.date,
    description,
    reference: input.reference,
    notes: "Cash payment to supplier — reduces payables",
    sourceModule: "Suppliers",
    sourceId: input.sourceId,
    sourceFingerprint: fingerprint,
    createdBy: input.createdBy || "Suppliers",
    lines: [
      createJournalLine({
        accountCode: debitAcct.code,
        accountName: debitAcct.name,
        debit: input.amount,
        memo: description,
      }),
      createJournalLine({
        accountCode: creditAcct.code,
        accountName: creditAcct.name,
        credit: input.amount,
        memo: description,
      }),
    ],
  });
}

function postSupplierPaymentJournalDirect(input: {
  schoolId: string;
  invoice: SupplierInvoice;
  payment: SupplierInvoicePaymentRecord;
  createdBy?: string;
}): AutoJournalResult {
  const debitAcct = resolveCoa(input.schoolId, ACCOUNTS_PAYABLE_CODE);
  const creditAcct = resolveCoa(input.schoolId, "1000");
  if (!debitAcct || !creditAcct) {
    return { ok: false, skipped: true, reason: "Payables or bank account missing in COA" };
  }

  const amount = normaliseMoney(input.payment.amount);
  const fingerprint = buildSourceFingerprint({
    sourceType: "supplier_payment",
    sourceId: `${input.invoice.id}::${input.payment.id}`,
    amount,
    date: input.payment.paymentDate,
  });

  return createAutoJournal({
    schoolId: input.schoolId,
    date: input.payment.paymentDate,
    description: `Supplier payment — ${input.invoice.supplierName}`,
    reference: input.payment.reference || input.invoice.invoiceNumber,
    notes: "Debit payables · Credit bank",
    sourceModule: "Suppliers",
    sourceId: `${input.invoice.id}::${input.payment.id}`,
    sourceFingerprint: fingerprint,
    createdBy: input.createdBy || "Suppliers",
    lines: [
      createJournalLine({
        accountCode: debitAcct.code,
        accountName: debitAcct.name,
        debit: amount,
      }),
      createJournalLine({
        accountCode: creditAcct.code,
        accountName: creditAcct.name,
        credit: amount,
      }),
    ],
  });
}

export type CreateSupplierInvoiceInput = {
  schoolId: string;
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
  notes: string;
  captureMethod: SupplierInvoiceCaptureMethod;
  attachmentName?: string;
  status?: SupplierInvoiceStatus;
  sourceBankTransactionId?: string;
  user?: string;
};

export function createSupplierInvoice(input: CreateSupplierInvoiceInput): SupplierInvoice {
  const totalAmount = normaliseMoney(
    input.totalAmount || normaliseMoney(input.amount) + normaliseMoney(input.vatAmount)
  );
  const fp = buildInvoiceFingerprint({
    supplierId: input.supplierId,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    totalAmount,
  });

  const existing = loadSupplierInvoices(input.schoolId);
  if (existing.some((r) => r.fingerprint === fp && r.status !== "Cancelled")) {
    throw new Error("A supplier invoice with the same supplier, number, date, and amount already exists.");
  }

  const now = new Date().toISOString();
  const invoice = recalcInvoiceBalances({
    id: uid("sinv"),
    supplierId: input.supplierId,
    supplierName: input.supplierName.trim(),
    category: input.category || "Other",
    invoiceNumber: input.invoiceNumber.trim(),
    invoiceDate: normaliseIsoDate(input.invoiceDate),
    dueDate: normaliseIsoDate(input.dueDate) || normaliseIsoDate(input.invoiceDate),
    amount: normaliseMoney(input.amount),
    vatAmount: normaliseMoney(input.vatAmount),
    totalAmount,
    description: input.description.trim(),
    status: input.status || "Draft",
    captureMethod: input.captureMethod,
    attachmentName: input.attachmentName || "",
    attachmentPreviewUrl: "",
    sourceBankTransactionId: input.sourceBankTransactionId || "",
    approvedBy: "",
    approvedAt: "",
    paidAmount: 0,
    balance: totalAmount,
    notes: input.notes.trim(),
    payments: [],
    fingerprint: fp,
    createdAt: now,
    updatedAt: now,
  });

  upsertSupplierInvoice(input.schoolId, invoice);
  recordSupplierInvoiceAudit(
    input.schoolId,
    "Invoice created",
    invoice.invoiceNumber || invoice.id,
    `${invoice.supplierName} · ${invoice.captureMethod} · ${invoice.status}`,
    input.user
  );
  return invoice;
}

export function submitSupplierInvoiceForApproval(
  schoolId: string,
  invoiceId: string,
  user?: string
): SupplierInvoice | null {
  const inv = getAndUpdate(schoolId, invoiceId, (row) => ({
    ...row,
    status: "Awaiting Approval",
    updatedAt: new Date().toISOString(),
  }));
  if (inv) {
    recordSupplierInvoiceAudit(schoolId, "Submitted for approval", inv.invoiceNumber, inv.supplierName, user);
  }
  return inv;
}

export function approveSupplierInvoice(
  schoolId: string,
  invoiceId: string,
  user?: string
): SupplierInvoice | null {
  const inv = getAndUpdate(schoolId, invoiceId, (row) => {
    const now = new Date().toISOString();
    return recalcInvoiceBalances({
      ...row,
      status: "Approved",
      approvedBy: user || "Finance User",
      approvedAt: now,
      updatedAt: now,
    });
  });
  if (!inv) return null;

  const journal = postSupplierInvoiceApprovalJournal({ schoolId, invoice: inv, createdBy: user });
  recordSupplierInvoiceAudit(
    schoolId,
    "Approved",
    inv.invoiceNumber,
    journal.ok
      ? `Approved · Journal ${journal.journalNo}`
      : `Approved · Journal skipped: ${"reason" in journal ? journal.reason : ""}`,
    user
  );
  return inv;
}

export function markSupplierInvoiceDisputed(
  schoolId: string,
  invoiceId: string,
  user?: string
): SupplierInvoice | null {
  const inv = getAndUpdate(schoolId, invoiceId, (row) => ({
    ...row,
    status: "Disputed",
    updatedAt: new Date().toISOString(),
  }));
  if (inv) recordSupplierInvoiceAudit(schoolId, "Disputed", inv.invoiceNumber, inv.supplierName, user);
  return inv;
}

export function cancelSupplierInvoice(
  schoolId: string,
  invoiceId: string,
  user?: string
): SupplierInvoice | null {
  const inv = getAndUpdate(schoolId, invoiceId, (row) =>
    recalcInvoiceBalances({
      ...row,
      status: "Cancelled",
      balance: 0,
      updatedAt: new Date().toISOString(),
    })
  );
  if (inv) recordSupplierInvoiceAudit(schoolId, "Cancelled", inv.invoiceNumber, inv.supplierName, user);
  return inv;
}

export function postSupplierInvoicePayment(input: {
  schoolId: string;
  invoiceId: string;
  paymentDate: string;
  amount: number;
  reference: string;
  method: string;
  notes: string;
  bankTransactionId?: string;
  user?: string;
}): SupplierInvoice | null {
  const payment: SupplierInvoicePaymentRecord = {
    id: uid("spay"),
    paymentDate: normaliseIsoDate(input.paymentDate),
    amount: normaliseMoney(input.amount),
    reference: input.reference.trim(),
    method: input.method.trim() || "EFT",
    notes: input.notes.trim(),
    bankTransactionId: input.bankTransactionId,
    createdAt: new Date().toISOString(),
  };

  let updated: SupplierInvoice | null = null;
  const rows = loadSupplierInvoices(input.schoolId);
  const idx = rows.findIndex((r) => r.id === input.invoiceId);
  if (idx < 0) return null;

  const inv = rows[idx];
  if (inv.status !== "Approved" && inv.status !== "Part Paid" && inv.status !== "Disputed") {
    throw new Error("Only approved supplier invoices can receive payments.");
  }

  const maxPay = normaliseMoney(inv.balance);
  if (payment.amount <= 0 || payment.amount > maxPay + 0.01) {
    throw new Error(`Payment must be between 0 and ${maxPay}.`);
  }

  const next = recalcInvoiceBalances({
    ...inv,
    payments: [...(inv.payments || []), payment],
    updatedAt: new Date().toISOString(),
  });
  rows[idx] = next;
  saveSupplierInvoices(input.schoolId, rows);
  updated = next;

  const journal = postSupplierInvoicePaymentJournal({
    schoolId: input.schoolId,
    invoice: next,
    payment,
    createdBy: input.user,
  });

  recordSupplierInvoiceAudit(
    input.schoolId,
    payment.amount >= next.balance - 0.01 ? "Paid" : "Part paid",
    next.invoiceNumber,
    journal.ok
      ? `Payment ${payment.amount} · Journal ${journal.journalNo}`
      : `Payment ${payment.amount}`,
    input.user
  );

  return updated;
}

function getAndUpdate(
  schoolId: string,
  invoiceId: string,
  fn: (row: SupplierInvoice) => SupplierInvoice
): SupplierInvoice | null {
  const rows = loadSupplierInvoices(schoolId);
  const idx = rows.findIndex((r) => r.id === invoiceId);
  if (idx < 0) return null;
  rows[idx] = recalcInvoiceBalances(fn(rows[idx]));
  saveSupplierInvoices(schoolId, rows);
  return rows[idx];
}

export function listOpenSupplierInvoicesForPayment(schoolId: string): SupplierInvoice[] {
  return loadSupplierInvoicesForAgeing(schoolId).filter(
    (inv) =>
      (inv.status === "Approved" || inv.status === "Part Paid" || inv.status === "Disputed") &&
      inv.balance > 0
  );
}

export type BankingMatchCandidate = {
  invoice: SupplierInvoice;
  score: number;
  reason: string;
};

export function suggestSupplierInvoicesForBankLine(input: {
  schoolId: string;
  description: string;
  amount: number;
  date: string;
  reference?: string;
}): BankingMatchCandidate[] {
  const open = listOpenSupplierInvoicesForPayment(input.schoolId);
  const desc = String(input.description || "").toLowerCase();
  const ref = String(input.reference || "").toLowerCase();
  const amt = normaliseMoney(input.amount);
  const date = normaliseIsoDate(input.date);

  const scored = open.map((invoice) => {
    let score = 0;
    const reasons: string[] = [];

    if (Math.abs(invoice.balance - amt) < 0.02) {
      score += 40;
      reasons.push("Amount matches balance");
    } else if (Math.abs(invoice.totalAmount - amt) < 0.02) {
      score += 30;
      reasons.push("Amount matches invoice total");
    }

    const invNo = String(invoice.invoiceNumber || "").trim().toLowerCase();
    if (invNo && (desc.includes(invNo) || ref.includes(invNo))) {
      score += 25;
      reasons.push("Invoice number in reference");
    }

    const name = String(invoice.supplierName || "").trim().toLowerCase();
    if (name.length > 2 && desc.includes(name)) {
      score += 20;
      reasons.push("Supplier name in description");
    }

    const due = normaliseIsoDate(invoice.dueDate);
    if (due && date) {
      const diff = Math.abs(
        (new Date(`${due}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) /
          (24 * 60 * 60 * 1000)
      );
      if (diff <= 14) {
        score += 10;
        reasons.push("Due date proximity");
      }
    }

    return { invoice, score, reason: reasons.join(" · ") || "Possible match" };
  });

  return scored.filter((s) => s.score >= 20).sort((a, b) => b.score - a.score);
}

export function matchBankTransactionToSupplierInvoice(input: {
  schoolId: string;
  invoiceId: string;
  bankTransactionId: string;
  paymentDate: string;
  amount: number;
  reference: string;
  user?: string;
}): SupplierInvoice | null {
  const inv = postSupplierInvoicePayment({
    schoolId: input.schoolId,
    invoiceId: input.invoiceId,
    paymentDate: input.paymentDate,
    amount: input.amount,
    reference: input.reference,
    method: "EFT",
    notes: "Banking match",
    bankTransactionId: input.bankTransactionId,
    user: input.user,
  });

  if (inv) {
    const rows = loadSupplierInvoices(input.schoolId);
    const idx = rows.findIndex((r) => r.id === inv.id);
    if (idx >= 0) {
      rows[idx] = {
        ...rows[idx],
        captureMethod: rows[idx].captureMethod === "Manual" ? "Banking Match" : rows[idx].captureMethod,
        sourceBankTransactionId: input.bankTransactionId,
      };
      saveSupplierInvoices(input.schoolId, rows);
    }
    recordSupplierInvoiceAudit(
      input.schoolId,
      "Banking match",
      inv.invoiceNumber,
      `Matched bank line ${input.bankTransactionId}`,
      input.user
    );
  }
  return inv;
}

export function createSupplierInvoiceFromBankLine(input: CreateSupplierInvoiceInput & {
  paymentDate: string;
  paymentReference: string;
  bankTransactionId: string;
  confirmCombined: boolean;
}): SupplierInvoice {
  if (!input.confirmCombined) {
    throw new Error("Confirmation required to create invoice and payment together.");
  }

  const invoice = createSupplierInvoice({
    ...input,
    captureMethod: "Banking Match",
    sourceBankTransactionId: input.bankTransactionId,
    status: "Awaiting Approval",
  });

  const approved = approveSupplierInvoice(input.schoolId, invoice.id, input.user);
  if (!approved) throw new Error("Failed to approve invoice from bank line.");

  return (
    postSupplierInvoicePayment({
      schoolId: input.schoolId,
      invoiceId: approved.id,
      paymentDate: input.paymentDate,
      amount: normaliseMoney(input.totalAmount),
      reference: input.paymentReference,
      method: "EFT",
      notes: "Created from bank line with payment",
      bankTransactionId: input.bankTransactionId,
      user: input.user,
    }) || approved
  );
}

export function supplierInvoiceStats(schoolId: string, asOfDate?: string) {
  const asOf = normaliseIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);
  const rows = loadSupplierInvoicesForAgeing(schoolId);
  const ym = asOf.slice(0, 7);

  return {
    open: rows.filter((r) => r.balance > 0 && r.status !== "Cancelled").length,
    awaitingApproval: rows.filter((r) => r.status === "Awaiting Approval").length,
    dueThisMonth: rows.filter(
      (r) => r.balance > 0 && r.dueDate.slice(0, 7) === ym
    ).length,
    overdue: rows.filter((r) => r.balance > 0 && r.dueDate < asOf).length,
    partPaid: rows.filter((r) => r.status === "Part Paid").length,
    paidThisMonth: rows.filter(
      (r) =>
        r.status === "Paid" &&
        (r.payments || []).some((p) => p.paymentDate.slice(0, 7) === ym)
    ).length,
  };
}
