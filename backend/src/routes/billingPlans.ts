import express from "express";
import { prisma } from "../prisma";

const router = express.Router();

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function pickPrimaryParent(links: any[]) {
  if (!Array.isArray(links) || links.length === 0) return null;
  return (links.find((x) => x?.isPrimary) ?? links[0])?.parent ?? null;
}

router.get("/learners", async (req, res) => {
  try {
    const schoolId = asString(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const classroom = asString(req.query.classroom);
    const group = asString(req.query.group);
    const q = asString(req.query.q);

    const where: any = {
      schoolId,
      ...(classroom && classroom !== "ALL" ? { className: classroom } : {}),
      ...(group && group !== "ALL" ? { grade: group } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { admissionNo: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const learners = await prisma.learner.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: {
        familyAccount: true,
        links: { include: { parent: true } },
      },
    });

    const rows = learners.map((l: any) => {
      const hasLinks = Array.isArray(l.links) && l.links.length > 0;
      const enrolledStatus = hasLinks ? "Enrolled" : "Unenrolled";

      return {
        learnerId: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        classroom: l.className ?? "",
        enrolledStatus,
        totalAmount: 0,
        billingPlanStatus: "No billing plan",
        fees: [],

        grade: l.grade ?? "",
        admissionNo: l.admissionNo ?? null,

        // Keep legacy field used by existing UI tables.
        childStatus: enrolledStatus,
      };
    });

    const classrooms: string[] = Array.from(
      new Set(rows.map((r: any) => String(r.classroom || "").trim()).filter(Boolean))
    ) as string[];
    classrooms.sort((a: string, b: string) => a.localeCompare(b));

    const groups: string[] = Array.from(
      new Set(rows.map((r: any) => String(r.grade || "").trim()).filter(Boolean))
    ) as string[];
    groups.sort((a: string, b: string) => a.localeCompare(b));

    return res.json({ success: true, learners: rows, classrooms, groups });
  } catch (error) {
    console.error("List billing plan learners error:", error);
    return res.status(500).json({ success: false, message: "Failed to load billing plan learners" });
  }
});

router.get("/fees", async (req, res) => {
  try {
    const schoolId = asString(req.query.schoolId);
    const q = asString(req.query.q);
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const where: any = {
      schoolId,
      isActive: true,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    };

    const fees = await prisma.feeStructure.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return res.json({
      success: true,
      fees: fees.map((f: any) => ({
        id: f.id,
        description: f.name,
        type: f.type ?? f.frequency ?? null,
        amount: Number(f.amount || 0),
      })),
    });
  } catch (error) {
    console.error("List billing plan fees error:", error);
    return res.status(500).json({ success: false, message: "Failed to load fees" });
  }
});

router.get("/learners/:learnerId", async (req, res) => {
  try {
    const learnerId = asString(req.params.learnerId);
    const schoolId = asString(req.query.schoolId);
    if (!learnerId) return res.status(400).json({ success: false, message: "learnerId is required" });
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const learner = await prisma.learner.findFirst({
      where: { id: learnerId, schoolId },
      include: {
        familyAccount: true,
        links: { include: { parent: true } },
      },
    });

    if (!learner) return res.status(404).json({ success: false, message: "Learner not found" });

    const parent = pickPrimaryParent((learner as any).links);

    // Load billing plan if it exists.
    const plan = await prisma.learnerBillingPlan.findFirst({
      where: { schoolId, learnerId: learner.id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
      },
    });

    return res.json({
      success: true,
      learner: {
        id: learner.id,
        firstName: learner.firstName,
        lastName: learner.lastName,
        grade: learner.grade,
        className: learner.className ?? null,
        admissionNo: learner.admissionNo ?? null,
        familyAccountId: learner.familyAccountId ?? null,
        accountRef: (learner as any).familyAccount?.accountRef ?? null,
      },
      profile: {
        parentId: parent?.id ?? null,
        parentName: parent ? `${parent.firstName || ""} ${parent.surname || ""}`.trim() : null,
        childStatus: parent?.status ?? "UNKNOWN",
        currentBalance: parent ? Number(parent.outstandingAmount || 0) : 0,
      },
      billingPlan: {
        excludeFromInvoiceRun: Boolean(plan?.excludeFromInvoiceRun),
        totalAmount: Array.isArray(plan?.items)
          ? plan!.items.reduce((sum: number, it: any) => sum + Number(it.amountCents || 0) / 100, 0)
          : 0,
        items: Array.isArray(plan?.items)
          ? plan!.items.map((it: any) => ({
              id: it.id,
              feeStructureId: it.feeStructureId,
              description: it.description,
              type: it.type ?? null,
              amount: Number(it.amountCents || 0) / 100,
              sortOrder: Number(it.sortOrder || 0),
              dueDate: it.dueDate ? it.dueDate.toISOString() : null,
            }))
          : [],
      },
    });
  } catch (error) {
    console.error("Get learner billing plan error:", error);
    return res.status(500).json({ success: false, message: "Failed to load learner billing plan" });
  }
});

router.put("/learners/:learnerId", async (req, res) => {
  try {
    const learnerId = asString(req.params.learnerId);
    const body = req.body ?? {};
    const schoolId = asString(body.schoolId);
    if (!learnerId) return res.status(400).json({ success: false, message: "learnerId is required" });
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const learner = await prisma.learner.findFirst({ where: { id: learnerId, schoolId } });
    if (!learner) return res.status(404).json({ success: false, message: "Learner not found" });

    const excludeFromInvoiceRun = Boolean(body.excludeFromInvoiceRun);
    const itemsRaw = Array.isArray(body.items) ? body.items : [];

    const requestedItems = itemsRaw
      .map((x: any, idx: number) => {
        const feeStructureId = asString(x?.feeStructureId);
        if (!feeStructureId) return null;
        const amount = Number(x?.amount ?? 0);
        const amountCents = Math.round(amount * 100);
        const sortOrder = Number(x?.sortOrder ?? idx) || idx;
        const dueDate = x?.dueDate ? new Date(String(x.dueDate)) : null;
        const safeDueDate = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;
        return { feeStructureId, amountCents, sortOrder, dueDate: safeDueDate };
      })
      .filter(Boolean) as { feeStructureId: string; amountCents: number; sortOrder: number; dueDate: Date | null }[];

    const plan = await prisma.$transaction(async (tx) => {
      const upserted = await tx.learnerBillingPlan.upsert({
        where: { learnerId: learner.id },
        update: { excludeFromInvoiceRun },
        create: {
          schoolId,
          learnerId: learner.id,
          excludeFromInvoiceRun,
        },
      });

      // Replace items deterministically by sort order.
      await tx.learnerBillingPlanItem.deleteMany({ where: { billingPlanId: upserted.id } });

      if (requestedItems.length) {
        const feeIds = requestedItems.map((i) => i.feeStructureId);
        const fees = await tx.feeStructure.findMany({
          where: { schoolId, id: { in: feeIds } },
          select: { id: true, name: true, type: true },
        });
        const feeById = new Map(fees.map((f) => [f.id, f]));

        await tx.learnerBillingPlanItem.createMany({
          data: requestedItems
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((it, idx) => {
              const fee = feeById.get(it.feeStructureId);
              const description = fee?.name ?? "Fee";
              const type = fee?.type ?? null;
              return {
                schoolId,
                billingPlanId: upserted.id,
                feeStructureId: it.feeStructureId,
                description,
                type,
                amountCents: it.amountCents,
                sortOrder: idx,
                dueDate: it.dueDate,
              };
            }),
        });
      }

      return tx.learnerBillingPlan.findFirst({
        where: { id: upserted.id },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
    });

    return res.json({
      success: true,
      billingPlan: {
        excludeFromInvoiceRun: Boolean(plan?.excludeFromInvoiceRun),
        totalAmount: Array.isArray(plan?.items)
          ? plan!.items.reduce((sum: number, it: any) => sum + Number(it.amountCents || 0) / 100, 0)
          : 0,
        items: Array.isArray(plan?.items)
          ? plan!.items.map((it: any) => ({
              id: it.id,
              feeStructureId: it.feeStructureId,
              description: it.description,
              type: it.type ?? null,
              amount: Number(it.amountCents || 0) / 100,
              sortOrder: Number(it.sortOrder || 0),
              dueDate: it.dueDate ? it.dueDate.toISOString() : null,
            }))
          : [],
      },
    });
  } catch (error: any) {
    console.error("Save learner billing plan error:", error);
    return res.status(500).json({ success: false, message: "Failed to save learner billing plan" });
  }
});

export default router;

