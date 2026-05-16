import { Router } from "express";

import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";

const router = Router();

// GET /api/statements/accounts?schoolId=...
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
        totalFee: true,
        familyAccountId: true,
        createdAt: true,
        familyAccount: { select: { accountRef: true, familyName: true } },
      },
    });

    const accounts = learners.map((l) => {
      const accountNo = resolveLearnerAccountNo(l);
      const row = l as typeof l & {
        balance?: number;
        lastInvoiceAmount?: number;
        lastPaymentAmount?: number;
      };
      const balance = Number(row.balance ?? row.totalFee ?? 0);
      const lastInvoiceAmount = Number(row.lastInvoiceAmount ?? 0);
      const lastPaymentAmount = Number(row.lastPaymentAmount ?? 0);

      let status = "Up To Date";
      if (balance > 10000) status = "Bad Debt";
      else if (balance > 0) status = "Recently Owing";
      else if (balance < 0) status = "Over Paid";

      return {
        accountNo,
        learnerId: l.id,
        schoolId: l.schoolId,
        name: l.firstName || "-",
        surname: l.lastName || "-",
        balance,
        lastInvoice: lastInvoiceAmount,
        lastPayment: lastPaymentAmount,
        status,
        familyAccountId: l.familyAccountId,
        familyName: l.familyAccount?.familyName ?? null,
      };
    });

    return res.json({ success: true, accounts });
  } catch (error) {
    console.error("[statements] GET /accounts failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
