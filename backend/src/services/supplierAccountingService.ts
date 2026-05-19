import crypto from "crypto";
import type { Prisma, SupplierInvoice, SupplierInvoiceStatus } from "@prisma/client";
import { prisma } from "../prisma";

const CREDITORS_CODE = "2000";
const BANK_CODE = "1000";
const DEFAULT_EXPENSE_CODE = "5900";

const EXPENSE_CATEGORY_ACCOUNT: Record<string, string> = {
  electricity: "5100",
  water: "5110",
  fuel: "5120",
  stationery: "5300",
  insurance: "5400",
  rent: "5500",
  maintenance: "5600",
  bank: "5700",
};

export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function roundMoney(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function parseIsoDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const d = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function expenseAccountForCategory(categoryName: string) {
  const key = String(categoryName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  for (const [token, code] of Object.entries(EXPENSE_CATEGORY_ACCOUNT)) {
    if (key.includes(token)) return code;
  }
  return DEFAULT_EXPENSE_CODE;
}

const DEFAULT_EXPENSE_CATEGORIES = [
  { code: "UTIL", name: "Utilities" },
  { code: "FUEL", name: "Fuel" },
  { code: "STAT", name: "Stationery" },
  { code: "FOOD", name: "Food / Tuckshop" },
  { code: "MAINT", name: "Maintenance" },
  { code: "INS", name: "Insurance" },
  { code: "IT", name: "IT / Software" },
  { code: "CLEAN", name: "Cleaning" },
  { code: "TRANS", name: "Transport" },
  { code: "PROF", name: "Professional Services" },
  { code: "RENT", name: "Rent / Bond" },
  { code: "OTHER", name: "Other" },
];

export async function ensureExpenseCategories(schoolId: string) {
  const count = await prisma.expenseCategory.count({ where: { schoolId } });
  if (count > 0) return prisma.expenseCategory.findMany({ where: { schoolId }, orderBy: { name: "asc" } });

  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
      id: newId("expcat"),
      schoolId,
      code: c.code,
      name: c.name,
    })),
  });

  return prisma.expenseCategory.findMany({ where: { schoolId }, orderBy: { name: "asc" } });
}

async function nextJournalNo(schoolId: string) {
  const count = await prisma.accountingJournal.count({ where: { schoolId } });
  return `J-${String(count + 1).padStart(5, "0")}`;
}

type JournalLineInput = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo?: string;
};

export async function createAccountingJournal(input: {
  schoolId: string;
  date: string;
  description: string;
  reference?: string;
  notes?: string;
  sourceModule?: string;
  sourceId?: string;
  sourceFingerprint?: string;
  createdBy?: string;
  lines: JournalLineInput[];
}) {
  const fingerprint = String(input.sourceFingerprint || "").trim();
  if (fingerprint) {
    const existing = await prisma.accountingJournal.findUnique({
      where: { schoolId_sourceFingerprint: { schoolId: input.schoolId, sourceFingerprint: fingerprint } },
    });
    if (existing) return { duplicate: true as const, journal: existing };
  }

  const debit = input.lines.reduce((s, l) => s + roundMoney(l.debit), 0);
  const credit = input.lines.reduce((s, l) => s + roundMoney(l.credit), 0);
  if (Math.abs(debit - credit) > 0.02) {
    throw new Error("Journal is not balanced");
  }

  const journal = await prisma.accountingJournal.create({
    data: {
      id: newId("jrnl"),
      schoolId: input.schoolId,
      journalNo: await nextJournalNo(input.schoolId),
      date: input.date.slice(0, 10),
      description: input.description,
      reference: input.reference || "",
      notes: input.notes || "",
      status: "Posted",
      sourceModule: input.sourceModule || "Suppliers",
      sourceId: input.sourceId || "",
      sourceFingerprint: fingerprint || null,
      createdBy: input.createdBy || "System",
      lines: {
        create: input.lines.map((l) => ({
          id: newId("jline"),
          accountCode: l.accountCode,
          accountName: l.accountName,
          debit: roundMoney(l.debit),
          credit: roundMoney(l.credit),
          memo: l.memo || "",
        })),
      },
    },
    include: { lines: true },
  });

  return { duplicate: false as const, journal };
}

export async function postSupplierInvoiceApprovalJournal(
  invoice: SupplierInvoice & { supplier: { supplierName: string } },
  primaryCategoryName = "Other"
) {
  const amount = roundMoney(invoice.totalAmount);
  if (amount <= 0) return null;

  const debitCode = expenseAccountForCategory(primaryCategoryName);
  const fingerprint = `supplier_invoice_approval::${invoice.id}::${amount}::${invoice.invoiceDate.toISOString().slice(0, 10)}`;

  return createAccountingJournal({
    schoolId: invoice.schoolId,
    date: invoice.invoiceDate.toISOString().slice(0, 10),
    description: `Supplier invoice — ${invoice.supplier.supplierName} — ${invoice.invoiceNumber || invoice.id}`,
    reference: invoice.invoiceNumber || invoice.id,
    notes: "DR Expense / CR Creditors Control",
    sourceModule: "Suppliers",
    sourceId: invoice.id,
    sourceFingerprint: fingerprint,
    lines: [
      {
        accountCode: debitCode,
        accountName: `Expense (${primaryCategoryName})`,
        debit: amount,
        credit: 0,
        memo: primaryCategoryName,
      },
      {
        accountCode: CREDITORS_CODE,
        accountName: "Creditors Control",
        debit: 0,
        credit: amount,
        memo: "Accounts payable",
      },
    ],
  });
}

export async function postSupplierPaymentJournal(input: {
  schoolId: string;
  invoice: SupplierInvoice & { supplier: { supplierName: string } };
  paymentId: string;
  amount: number;
  paymentDate: Date;
  reference: string;
}) {
  const amount = roundMoney(input.amount);
  if (amount <= 0) return null;

  const fingerprint = `supplier_payment::${input.invoice.id}::${input.paymentId}::${amount}::${input.paymentDate.toISOString().slice(0, 10)}`;

  return createAccountingJournal({
    schoolId: input.schoolId,
    date: input.paymentDate.toISOString().slice(0, 10),
    description: `Supplier payment — ${input.invoice.supplier.supplierName}`,
    reference: input.reference || input.invoice.invoiceNumber,
    notes: "DR Creditors Control / CR Bank",
    sourceModule: "Suppliers",
    sourceId: `${input.invoice.id}::${input.paymentId}`,
    sourceFingerprint: fingerprint,
    lines: [
      {
        accountCode: CREDITORS_CODE,
        accountName: "Creditors Control",
        debit: amount,
        credit: 0,
        memo: "Reduce payables",
      },
      {
        accountCode: BANK_CODE,
        accountName: "Bank",
        debit: 0,
        credit: amount,
        memo: "Bank payment",
      },
    ],
  });
}

export function resolveInvoiceStatus(
  totalAmount: number,
  outstandingAmount: number,
  current: SupplierInvoiceStatus
): SupplierInvoiceStatus {
  if (current === "pending") return current;
  const out = roundMoney(outstandingAmount);
  const total = roundMoney(totalAmount);
  if (out <= 0.009) return "paid";
  if (out < total - 0.009) return "partially_paid";
  return "approved";
}

export async function recalcInvoiceOutstanding(invoiceId: string) {
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true, supplier: true, lines: { include: { expenseCategory: true } } },
  });
  if (!invoice) return null;

  const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = Math.max(0, roundMoney(Number(invoice.totalAmount) - paid));
  let status = invoice.status;
  if (status !== "pending") {
    status = resolveInvoiceStatus(Number(invoice.totalAmount), outstanding, status);
  }

  const updated = await prisma.supplierInvoice.update({
    where: { id: invoiceId },
    data: { outstandingAmount: outstanding, status },
    include: {
      supplier: true,
      lines: { include: { expenseCategory: true } },
      payments: { orderBy: { paymentDate: "desc" } },
    },
  });

  return updated;
}

export async function supplierOutstandingTotals(schoolId: string) {
  const rows = await prisma.supplierInvoice.groupBy({
    by: ["supplierId"],
    where: {
      schoolId,
      status: { in: ["approved", "partially_paid", "pending"] },
    },
    _sum: { outstandingAmount: true },
  });
  return new Map(rows.map((r) => [r.supplierId, roundMoney(r._sum.outstandingAmount)]));
}

export function mapJournalToApi(
  journal: Prisma.AccountingJournalGetPayload<{ include: { lines: true } }>
) {
  return {
    id: journal.id,
    journalNo: journal.journalNo,
    date: journal.date,
    description: journal.description,
    reference: journal.reference,
    notes: journal.notes,
    status: journal.status,
    sourceModule: journal.sourceModule,
    sourceId: journal.sourceId,
    sourceFingerprint: journal.sourceFingerprint,
    createdBy: journal.createdBy,
    createdAt: journal.createdAt.toISOString(),
    updatedAt: journal.updatedAt.toISOString(),
    lines: journal.lines.map((l) => ({
      id: l.id,
      accountCode: l.accountCode,
      accountName: l.accountName,
      debit: Number(l.debit),
      credit: Number(l.credit),
      memo: l.memo,
    })),
  };
}
