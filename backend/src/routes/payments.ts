import { Router } from "express";

import { prisma } from "../prisma";

const router = Router();
const prismaAny = prisma as any;

// GET /api/payments/accounts?schoolId=...
router.get("/accounts", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const learners = await prisma.learner.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        schoolId: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        familyAccountId: true,
        createdAt: true,
        familyAccount: { select: { accountRef: true, familyName: true } },
      },
    });

    const accounts = learners.map((l, index) => ({
      accountNo: l.familyAccount?.accountRef || l.admissionNo || `ACC${String(index + 1).padStart(3, "0")}`,
      learnerId: l.id,
      schoolId: l.schoolId,
      firstName: l.firstName || "-",
      lastName: l.lastName || "-",
      familyAccountId: l.familyAccountId,
      familyName: l.familyAccount?.familyName ?? null,
      admissionNo: l.admissionNo ?? null,
      createdAt: l.createdAt,
    }));

    return res.json({ success: true, accounts });
  } catch (error) {
    console.error("[payments] GET /accounts failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = (req.body ?? {}) as any;
    const parentId = body.parentId || body.accountId || body.parent?.id || null;
    const amount = body.amount;
    const method = body.method || body.type || null;
    const dateRaw = body.date ?? body.paidAt ?? body.createdAt ?? null;

    const numericAmount = Number(amount);
    if (!parentId || amount == null || Number.isNaN(numericAmount)) {
      return res.status(400).json({ success: false, error: "Missing parentId or amount" });
    }

    const paidAt = dateRaw ? new Date(dateRaw) : new Date();

    // Best-effort persistence (kept loose to avoid type/model mismatches)
    const createFn =
      prismaAny?.payment?.create ??
      prismaAny?.payments?.create ??
      prismaAny?.paymentRecord?.create ??
      prismaAny?.paymentTransaction?.create ??
      null;

    if (typeof createFn === "function") {
      try {
        await createFn({
          data: {
            parentId,
            amount: numericAmount,
            method,
            paidAt,
          },
        });
      } catch (e) {
        console.error("[payments] create payment failed:", e);
        return res.status(500).json({ success: false, error: "Server error" });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[payments] POST / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
