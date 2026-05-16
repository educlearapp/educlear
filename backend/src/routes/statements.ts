import { Router } from "express";

import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  calculateBalanceForAccount,
  readSchoolLedger,
} from "../utils/billingLedgerStore";

const router = Router();

function statusFromBalance(balance: number) {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

function buildAccountsFromLearners(schoolId: string, ledger: ReturnType<typeof readSchoolLedger>) {
  return prisma.learner
    .findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        schoolId: true,
        firstName: true,
        lastName: true,
        familyAccountId: true,
        familyAccount: { select: { accountRef: true, familyName: true } },
      },
    })
    .then((learners) =>
      learners.map((l) => {
        const accountNo = resolveLearnerAccountNo(l);
        const accountEntries = ledger.filter(
          (e) =>
            String(e.learnerId) === l.id ||
            (accountNo && String(e.accountNo) === accountNo)
        );
        const lastInvoice = accountEntries
          .filter((e) => e.type === "invoice")
          .sort(
            (a, b) =>
              new Date(b.date || b.createdAt).getTime() -
              new Date(a.date || a.createdAt).getTime()
          )[0];
        const lastPayment = accountEntries
          .filter((e) => e.type === "payment")
          .sort(
            (a, b) =>
              new Date(b.date || b.createdAt).getTime() -
              new Date(a.date || a.createdAt).getTime()
          )[0];
        const balance = calculateBalanceForAccount(ledger, l.id, accountNo);

        return {
          accountNo,
          learnerId: l.id,
          schoolId: l.schoolId,
          name: l.firstName || "-",
          surname: l.lastName || "-",
          balance,
          lastInvoice: lastInvoice?.amount ?? 0,
          lastInvoiceDate: lastInvoice?.date || "",
          lastPayment: lastPayment?.amount ?? 0,
          lastPaymentDate: lastPayment?.date || "",
          status: statusFromBalance(balance),
          familyAccountId: l.familyAccountId,
          familyName: l.familyAccount?.familyName ?? null,
        };
      })
    );
}

// GET /api/statements?schoolId=...
router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const ledger = readSchoolLedger(schoolId);
    const accounts = await buildAccountsFromLearners(schoolId, ledger);
    return res.json({ success: true, statements: accounts, accounts });
  } catch (error) {
    console.error("[statements] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/statements/accounts?schoolId=...
router.get("/accounts", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const ledger = readSchoolLedger(schoolId);
    const accounts = await buildAccountsFromLearners(schoolId, ledger);
    return res.json({ success: true, accounts });
  } catch (error) {
    console.error("[statements] GET /accounts failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
