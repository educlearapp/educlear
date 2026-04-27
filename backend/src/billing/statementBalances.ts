type InvoiceLineLike = {
  id?: string;
  description?: string;
  amountCents: number;
  sortOrder?: number | null;
  dueDate?: Date | string | null;
};

type InvoiceLike = {
  id: string;
  parentId?: string;
  invoiceDate: Date | string;
  dueDate: Date | string;
  amountCents: number;
  createdAt?: Date | string;
  lines?: InvoiceLineLike[] | null;
  learner?: any;
  familyAccount?: any;
};

type PaymentLike = {
  amount: number;
  createdAt?: Date | string;
};

export type StatementLine = {
  kind: "INVOICE_LINE";
  invoiceId: string;
  invoiceDate: string;
  dueDate: string;
  description: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  status: "Paid" | "Not due yet" | "Overdue";
};

export type StatementBalanceSummary = {
  totalOutstandingBalanceCents: number;
  overdueBalanceCents: number;
  nextDueDate: string | null;
  statementLines: StatementLine[];
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function iso(d: Date) {
  return d.toISOString();
}

export function computeStatementBalances(input: {
  invoices: InvoiceLike[];
  payments: PaymentLike[];
  now?: Date;
}): StatementBalanceSummary {
  const now = input.now ?? new Date();
  const todayStart = startOfToday(now);

  const invoices = Array.isArray(input.invoices) ? input.invoices.slice() : [];
  const payments = Array.isArray(input.payments) ? input.payments.slice() : [];

  const totalPaymentsCents = payments.reduce((sum, p) => sum + Math.round(Number(p.amount || 0) * 100), 0);
  let remainingPaymentsCents = totalPaymentsCents;

  invoices.sort((a, b) => {
    const ad = asDate(a.invoiceDate)?.getTime() ?? 0;
    const bd = asDate(b.invoiceDate)?.getTime() ?? 0;
    if (ad !== bd) return ad - bd;
    const ac = asDate(a.createdAt)?.getTime() ?? 0;
    const bc = asDate(b.createdAt)?.getTime() ?? 0;
    return ac - bc;
  });

  const statementLines: StatementLine[] = [];

  for (const inv of invoices) {
    const invDue = asDate(inv.dueDate) ?? todayStart;
    const invDate = asDate(inv.invoiceDate) ?? todayStart;

    // If lines exist, treat them as the source of truth for statement rows.
    const lines: InvoiceLineLike[] =
      Array.isArray(inv.lines) && inv.lines.length
        ? inv.lines.slice()
        : [
            {
              description: "Invoice",
              amountCents: Number(inv.amountCents || 0),
              sortOrder: 0,
              dueDate: invDue,
            },
          ];

    lines.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

    const invoiceTotalCents = lines.reduce((s, l) => s + Number(l.amountCents || 0), 0);
    const paidToInvoiceCents = Math.min(Math.max(remainingPaymentsCents, 0), Math.max(invoiceTotalCents, 0));
    remainingPaymentsCents -= paidToInvoiceCents;

    let remainingPaidForInvoiceCents = paidToInvoiceCents;

    for (const line of lines) {
      const amountCents = Number(line.amountCents || 0);
      const paidCents = Math.min(Math.max(remainingPaidForInvoiceCents, 0), Math.max(amountCents, 0));
      remainingPaidForInvoiceCents -= paidCents;

      const balanceCents = amountCents - paidCents;
      const lineDue = asDate(line.dueDate) ?? invDue;

      let status: StatementLine["status"] = "Paid";
      if (balanceCents > 0) {
        status = lineDue.getTime() < todayStart.getTime() ? "Overdue" : "Not due yet";
      }

      statementLines.push({
        kind: "INVOICE_LINE",
        invoiceId: inv.id,
        invoiceDate: iso(invDate),
        dueDate: iso(lineDue),
        description: String(line.description || "Invoice"),
        amountCents,
        paidCents,
        balanceCents,
        status,
      });
    }
  }

  const totalOutstandingBalanceCents = statementLines.reduce((s, l) => s + Math.max(0, l.balanceCents), 0);
  const overdueBalanceCents = statementLines.reduce((s, l) => {
    if (l.balanceCents <= 0) return s;
    const d = asDate(l.dueDate);
    if (!d) return s;
    return d.getTime() < todayStart.getTime() ? s + l.balanceCents : s;
  }, 0);

  const nextDueMs = statementLines
    .filter((l) => l.balanceCents > 0)
    .map((l) => asDate(l.dueDate)?.getTime() ?? null)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t >= todayStart.getTime())
    .sort((a, b) => a - b)[0];

  return {
    totalOutstandingBalanceCents,
    overdueBalanceCents,
    nextDueDate: typeof nextDueMs === "number" ? new Date(nextDueMs).toISOString() : null,
    statementLines,
  };
}

