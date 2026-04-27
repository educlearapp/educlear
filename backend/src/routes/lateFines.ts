import express from "express";
import crypto from "crypto";
import { prisma } from "../prisma";
import { computeStatementBalances } from "../billing/statementBalances";

const router = express.Router();

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function parseIsoDate(value: unknown, field: string): Date {
  const s = asString(value);
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) throw new Error(`${field} must be a valid ISO date`);
  return d;
}

function centsFromAmount(amount: unknown, field = "amount"): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  const cents = Math.round(n * 100);
  if (cents <= 0) throw new Error(`${field} must be > 0`);
  return cents;
}

function amountFromCents(cents: unknown): number {
  const n = Number(cents || 0);
  return Number.isFinite(n) ? n / 100 : 0;
}

function yyyyMmFromDate(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}`;
}

function buildUniqueKey(input: unknown) {
  const s = JSON.stringify(input);
  return crypto.createHash("sha256").update(s).digest("hex");
}

router.get("/accounts", async (req, res) => {
  try {
    const schoolId = asString(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const parents = await prisma.parent.findMany({
      where: {
        schoolId,
        outstandingAmount: { gt: 0 },
      },
      orderBy: [{ outstandingAmount: "desc" }, { surname: "asc" }, { firstName: "asc" }],
      include: {
        familyAccount: true,
        links: { include: { learner: true } },
      },
      take: 5000,
    });

    const parentIds = parents.map((p) => p.id);

    const [invoices, payments] = await Promise.all([
      parentIds.length
        ? prisma.invoice.findMany({
            where: { schoolId, parentId: { in: parentIds } },
            select: {
              id: true,
              parentId: true,
              invoiceDate: true,
              dueDate: true,
              amountCents: true,
              createdAt: true,
              lines: {
                select: { id: true, description: true, amountCents: true, sortOrder: true, dueDate: true },
              },
            },
            orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
            take: 200000,
          })
        : [],
      parentIds.length
        ? prisma.payment.findMany({
            where: { schoolId, parentId: { in: parentIds } },
            select: { parentId: true, amount: true, createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 200000,
          })
        : [],
    ]);

    const invoicesByParentId = new Map<string, any[]>();
    for (const inv of invoices as any[]) {
      const pid = String(inv.parentId || "");
      if (!pid) continue;
      const list = invoicesByParentId.get(pid) ?? [];
      list.push(inv);
      invoicesByParentId.set(pid, list);
    }

    const paymentsByParentId = new Map<string, any[]>();
    for (const p of payments as any[]) {
      const pid = String(p.parentId || "");
      if (!pid) continue;
      const list = paymentsByParentId.get(pid) ?? [];
      list.push(p);
      paymentsByParentId.set(pid, list);
    }

    const lastPayments = parentIds.length
      ? await prisma.payment.groupBy({
          by: ["parentId"],
          where: { schoolId, parentId: { in: parentIds } },
          _max: { createdAt: true },
        })
      : [];

    const lastPaymentByParentId = new Map<string, Date>();
    for (const row of lastPayments as any[]) {
      if (row?.parentId && row?._max?.createdAt) lastPaymentByParentId.set(row.parentId, row._max.createdAt);
    }

    const accounts = parents
      .map((p) => {
      const learners = Array.isArray(p.links) ? p.links.map((l) => l.learner).filter(Boolean) : [];
      const primaryLearner = learners[0] ?? null;
      const parentName = `${p.firstName || ""} ${p.surname || ""}`.trim();
      const learnerName = primaryLearner ? `${primaryLearner.firstName || ""} ${primaryLearner.lastName || ""}`.trim() : "";
      const displayName = learnerName ? `${parentName} / ${learnerName}` : parentName;

      const computed = computeStatementBalances({
        invoices: invoicesByParentId.get(p.id) ?? [],
        payments: paymentsByParentId.get(p.id) ?? [],
      });

      return {
        parentId: p.id,
        accountRef: p.familyAccount?.accountRef || null,
        name: displayName,
        outstandingBalance: computed.totalOutstandingBalanceCents / 100,
        overdueBalance: computed.overdueBalanceCents / 100,
        nextDueDate: computed.nextDueDate,
        lastPaymentDate: lastPaymentByParentId.get(p.id)?.toISOString() ?? null,
        familyAccountId: p.familyAccountId ?? null,
      };
    })
      .filter((a: any) => Number(a.overdueBalance || 0) > 0);

    return res.json({ ok: true, accounts });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load accounts" });
  }
});

router.get("/runs", async (req, res) => {
  try {
    const schoolId = asString(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const runs = await prisma.lateFineRun.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        _count: { select: { items: true } },
      },
    });

    return res.json({
      ok: true,
      runs: runs.map((r) => ({
        id: r.id,
        invoiceRunId: r.invoiceRunId,
        description: r.description,
        note: r.note ?? null,
        invoiceDate: r.invoiceDate,
        fineAmount: amountFromCents(r.fineAmountCents),
        createdAt: r.createdAt,
        itemsCount: (r as any)?._count?.items ?? 0,
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load runs" });
  }
});

router.post("/run", async (req, res) => {
  try {
    const body = req.body ?? {};
    const schoolId = asString(body.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const description = asString(body.description) || "Late payment fine";
    const note = asString(body.note) || null;
    const invoiceDate = parseIsoDate(body.invoiceDate, "invoiceDate");

    const defaultFineAmountCents = centsFromAmount(body.fineAmount, "fineAmount");

    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    if (!itemsRaw.length) return res.status(400).json({ ok: false, error: "At least 1 account is required" });

    type RequestedItem = { parentId: string; amountCents: number };
    const requested: RequestedItem[] = itemsRaw.map((x: any) => {
      const parentId = asString(x?.parentId);
      if (!parentId) throw new Error("parentId is required");
      const amountCents =
        x?.fineAmount === undefined || x?.fineAmount === null
          ? defaultFineAmountCents
          : centsFromAmount(x.fineAmount, "fineAmount");
      return { parentId, amountCents };
    });

    // Deterministic idempotency key (prevents duplicate fine charges for the same run payload).
    const uniqueKey = buildUniqueKey({
      schoolId,
      description,
      note,
      invoiceDate: invoiceDate.toISOString().slice(0, 10),
      items: requested
        .slice()
        .sort((a: RequestedItem, b: RequestedItem) => a.parentId.localeCompare(b.parentId))
        .map((x: RequestedItem) => ({ parentId: x.parentId, amountCents: x.amountCents })),
    });

    const existing = await prisma.lateFineRun.findUnique({
      where: { schoolId_uniqueKey: { schoolId, uniqueKey } },
      include: { _count: { select: { items: true } } },
    });
    if (existing) {
      return res.json({
        ok: true,
        alreadyApplied: true,
        run: {
          id: existing.id,
          invoiceRunId: existing.invoiceRunId,
          description: existing.description,
          note: existing.note ?? null,
          invoiceDate: existing.invoiceDate,
          fineAmount: amountFromCents(existing.fineAmountCents),
          createdAt: existing.createdAt,
          itemsCount: (existing as any)?._count?.items ?? 0,
        },
        summary: { invoicesCreated: 0 },
      });
    }

    const invoiceMonth = yyyyMmFromDate(invoiceDate);
    const dueDate = invoiceDate; // Fine is due immediately (keeps existing invoice schema happy)

    const result = await prisma.$transaction(async (tx) => {
      const runInvoiceRun = await tx.invoiceRun.create({
        data: {
          schoolId,
          description,
          invoiceDate,
          dueDate,
          invoiceMonth,
          message: note,
        },
      });

      const fineRun = await tx.lateFineRun.create({
        data: {
          schoolId,
          invoiceRunId: runInvoiceRun.id,
          uniqueKey,
          description,
          note,
          invoiceDate,
          fineAmountCents: defaultFineAmountCents,
        },
      });

      const createdInvoiceIds: string[] = [];

      for (const reqItem of requested) {
        const parent = await tx.parent.findFirst({
          where: { id: reqItem.parentId, schoolId },
          include: { familyAccount: true },
        });
        if (!parent) throw new Error(`Parent not found for school (${reqItem.parentId})`);

        const previousOutstanding = Number(parent.outstandingAmount || 0);
        if (!(previousOutstanding > 0)) {
          // Defensive: we only fine accounts with a balance, per requirement.
          continue;
        }

        const inv = await tx.invoice.create({
          data: {
            schoolId,
            invoiceRunId: runInvoiceRun.id,
            parentId: parent.id,
            learnerId: null,
            familyAccountId: parent.familyAccountId ?? null,
            accountRef: parent.familyAccount?.accountRef ?? null,
            invoiceDate,
            dueDate,
            amountCents: reqItem.amountCents,
            lines: {
              create: [
                {
                  description,
                  amountCents: reqItem.amountCents,
                  sortOrder: 0,
                },
              ],
            },
          },
          include: { lines: true },
        });

        const paymentDelta = amountFromCents(reqItem.amountCents);
        const newOutstanding = previousOutstanding + paymentDelta;

        await tx.parent.update({
          where: { id: parent.id },
          data: { outstandingAmount: newOutstanding },
        });

        const lineId = inv.lines?.[0]?.id;
        if (!lineId) throw new Error("Failed to create invoice line for fine");

        await tx.lateFineRunItem.create({
          data: {
            schoolId,
            lateFineRunId: fineRun.id,
            parentId: parent.id,
            familyAccountId: parent.familyAccountId ?? null,
            invoiceId: inv.id,
            invoiceLineId: lineId,
            amountCents: reqItem.amountCents,
            previousOutstandingAmount: previousOutstanding,
            newOutstandingAmount: newOutstanding,
          },
        });

        createdInvoiceIds.push(inv.id);
      }

      return { fineRun, invoiceRunId: runInvoiceRun.id, createdInvoiceIds };
    });

    return res.json({
      ok: true,
      alreadyApplied: false,
      run: {
        id: result.fineRun.id,
        invoiceRunId: result.invoiceRunId,
        description: result.fineRun.description,
        note: result.fineRun.note ?? null,
        invoiceDate: result.fineRun.invoiceDate,
        fineAmount: amountFromCents(result.fineRun.fineAmountCents),
        createdAt: result.fineRun.createdAt,
      },
      summary: {
        invoicesCreated: result.createdInvoiceIds.length,
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("required") || msg.includes("must be") || msg.includes("not found")) {
      return res.status(400).json({ ok: false, error: msg });
    }
    return res.status(500).json({ ok: false, error: msg || "Failed to apply fines" });
  }
});

export default router;

