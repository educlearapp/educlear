import express from "express";
import { prisma } from "../prisma";

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

function parseInvoiceMonth(value: unknown): string {
  const s = asString(value);
  // Expect YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(s)) throw new Error("invoiceMonth must be in YYYY-MM format");
  return s;
}

function centsFromAmount(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error("amount must be a number");
  return Math.round(n * 100);
}

function amountFromCents(cents: unknown): number {
  const n = Number(cents || 0);
  return Number.isFinite(n) ? n / 100 : 0;
}

router.get("/learners", async (req, res) => {
  try {
    const schoolId = asString(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const learners = await prisma.learner.findMany({
      where: { schoolId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        familyAccount: true,
        links: { include: { parent: true } },
      },
    });

    const learnerIds = learners.map((l: any) => l.id);
    const plans = learnerIds.length
      ? await prisma.learnerBillingPlan.findMany({
          where: { schoolId, learnerId: { in: learnerIds } },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        })
      : [];
    const planByLearnerId = new Map<string, any>();
    for (const p of plans as any[]) planByLearnerId.set(String(p.learnerId), p);

    const rows = learners.map((l: any) => {
      const familyAccountId = l.familyAccountId || null;
      const accountRef = l.familyAccount?.accountRef || null;

      const primaryLink =
        Array.isArray(l.links) && l.links.length
          ? (l.links.find((x: any) => x?.isPrimary) ?? l.links[0])
          : null;
      const parent = primaryLink?.parent ?? null;
      const parentId = parent?.id ?? null;
      const currentBalance = parent ? Number(parent.outstandingAmount || 0) : 0;

      const plan = planByLearnerId.get(String(l.id)) ?? null;
      const planItems = Array.isArray(plan?.items) ? plan.items : [];
      const billingPlanLines = planItems.map((it: any) => ({
        id: it.id,
        description: it.description,
        amount: amountFromCents(it.amountCents),
        dueDate: it.dueDate ? it.dueDate.toISOString() : null,
      }));
      const billingPlanAmount = billingPlanLines.reduce((sum: number, x: any) => sum + Number(x.amount || 0), 0);

      return {
        learnerId: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        grade: l.grade,
        className: l.className ?? null,

        familyAccountId,
        accountRef,

        parentId,
        parentName: parent ? `${parent.firstName || ""} ${parent.surname || ""}`.trim() : null,
        currentBalance,

        billingPlanAmount,
        hasBillingPlan: billingPlanLines.length > 0,
        billingPlanLines,
      };
    });

    return res.json({ success: true, learners: rows });
  } catch (error) {
    console.error("Invoice run learners error:", error);
    return res.status(500).json({ success: false, message: "Failed to load learners" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const schoolId = asString(body.schoolId);
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const description = asString(body.description) || null;
    const invoiceDate = parseIsoDate(body.invoiceDate, "invoiceDate");
    const dueDate = parseIsoDate(body.dueDate, "dueDate");
    const invoiceMonth = parseInvoiceMonth(body.invoiceMonth);
    const message = asString(body.message) || null;

    const learners = Array.isArray(body.learners) ? body.learners : [];
    if (learners.length === 0) {
      return res.status(400).json({ success: false, message: "At least 1 learner is required" });
    }

    // Validate payload early.
    const requested = learners.map((x: any) => {
      const learnerId = asString(x?.learnerId);
      const parentId = asString(x?.parentId);
      const familyAccountId = asString(x?.familyAccountId) || null;
      const accountRef = asString(x?.accountRef) || null;
      const lines = Array.isArray(x?.lines) ? x.lines : [];

      if (!learnerId) throw new Error("learnerId is required");
      if (!parentId) throw new Error(`parentId is required for learner ${learnerId}`);

      const normalizedLines = lines
        .map((l: any, idx: number) => {
          const desc = asString(l?.description);
          const amountCents = centsFromAmount(l?.amount);
          if (!desc) throw new Error(`Line description is required for learner ${learnerId}`);
          const lineDueDate = l?.dueDate ? parseIsoDate(l.dueDate, "dueDate") : null;
          return { description: desc, amountCents, sortOrder: Number(l?.sortOrder ?? idx) || idx, dueDate: lineDueDate };
        })
        .filter((l: any) => l.amountCents !== 0);

      const totalCents = normalizedLines.reduce((sum: number, l: any) => sum + Number(l.amountCents || 0), 0);
      if (totalCents <= 0) {
        throw new Error(`Invoice amount must be > 0 for learner ${learnerId}`);
      }

      return {
        learnerId,
        parentId,
        familyAccountId,
        accountRef,
        totalCents,
        lines: normalizedLines,
      };
    });

    // Execute transaction: create run + invoices + lines + update balances.
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.invoiceRun.create({
        data: {
          schoolId,
          description,
          invoiceDate,
          dueDate,
          invoiceMonth,
          message,
        },
      });

      const createdInvoices: any[] = [];

      for (const item of requested) {
        // Ensure learner belongs to school (defensive).
        const learner = await tx.learner.findFirst({
          where: { id: item.learnerId, schoolId },
        });
        if (!learner) {
          throw new Error(`Learner not found for school (${item.learnerId})`);
        }

        const parent = await tx.parent.findFirst({
          where: { id: item.parentId, schoolId },
        });
        if (!parent) {
          throw new Error(`Parent not found for school (${item.parentId})`);
        }

        const inv = await tx.invoice.create({
          data: {
            schoolId,
            invoiceRunId: run.id,
            parentId: parent.id,
            learnerId: learner.id,
            familyAccountId: item.familyAccountId,
            accountRef: item.accountRef,
            invoiceDate,
            dueDate,
            amountCents: item.totalCents,
            lines: {
              create: item.lines.map((l: any) => ({
                description: l.description,
                amountCents: l.amountCents,
                sortOrder: l.sortOrder,
                dueDate: l.dueDate ?? null,
              })),
            },
          },
          include: { lines: true },
        });

        await tx.parent.update({
          where: { id: parent.id },
          data: {
            outstandingAmount: Number(parent.outstandingAmount || 0) + amountFromCents(item.totalCents),
          },
        });

        createdInvoices.push(inv);
      }

      return { run, createdInvoices };
    });

    const created = (result.createdInvoices || []).map((inv: any) => ({
      id: inv.id,
      parentId: inv.parentId,
      learnerId: inv.learnerId,
      accountRef: inv.accountRef ?? null,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      amount: amountFromCents(inv.amountCents),
      lines: Array.isArray(inv.lines)
        ? inv.lines
            .slice()
            .sort((a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
            .map((l: any) => ({
              id: l.id,
              description: l.description,
              amount: amountFromCents(l.amountCents),
            }))
        : [],
    }));

    const totalAmount = created.reduce((sum: number, x: any) => sum + Number(x.amount || 0), 0);

    return res.json({
      success: true,
      invoiceRun: {
        id: result.run.id,
        schoolId: result.run.schoolId,
        description: result.run.description ?? null,
        invoiceDate: result.run.invoiceDate,
        dueDate: result.run.dueDate,
        invoiceMonth: result.run.invoiceMonth,
        message: result.run.message ?? null,
        createdAt: result.run.createdAt,
      },
      summary: {
        invoicesCreated: created.length,
        totalAmount,
      },
      invoices: created,
    });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (
      msg.includes("required") ||
      msg.includes("must be a valid ISO date") ||
      msg.includes("YYYY-MM") ||
      msg.includes("must be > 0")
    ) {
      return res.status(400).json({ success: false, message: msg });
    }
    console.error("Create invoice run error:", error);
    return res.status(500).json({ success: false, message: "Failed to create invoices" });
  }
});

export default router;

