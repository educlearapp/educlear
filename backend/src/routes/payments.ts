import { Router } from "express";

import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  appendSchoolEntry,
  calculateBalanceForAccount,
  listPayments,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const router = Router();

function lastInvoiceAmount(entries: BillingLedgerEntry[], learnerId: string, accountNo: string) {
  const matched = entries.filter(
    (e) =>
      e.type === "invoice" &&
      (String(e.learnerId) === learnerId || String(e.accountNo) === accountNo)
  );
  const sorted = matched.sort(
    (a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
  );
  return sorted[0]?.amount ?? 0;
}

function lastPaymentAmount(entries: BillingLedgerEntry[], learnerId: string, accountNo: string) {
  const matched = entries.filter(
    (e) =>
      e.type === "payment" &&
      (String(e.learnerId) === learnerId || String(e.accountNo) === accountNo)
  );
  const sorted = matched.sort(
    (a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
  );
  return sorted[0]?.amount ?? 0;
}

// GET /api/payments?schoolId=...
router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const payments = listPayments(schoolId).map((entry) => ({
      id: entry.id,
      learnerId: entry.learnerId,
      accountNo: entry.accountNo,
      amount: entry.amount,
      paymentDate: entry.date,
      date: entry.date,
      method: entry.method,
      reference: entry.reference,
      description: entry.description,
      type: entry.type,
      createdAt: entry.createdAt,
    }));

    return res.json({ success: true, payments });
  } catch (error) {
    console.error("[payments] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/payments/accounts?schoolId=...
router.get("/accounts", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const ledger = readSchoolLedger(schoolId);
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

    const accounts = learners.map((l) => {
      const accountNo = resolveLearnerAccountNo(l);
      const balance = calculateBalanceForAccount(ledger, l.id, accountNo);
      return {
        accountNo,
        learnerId: l.id,
        schoolId: l.schoolId,
        firstName: l.firstName || "-",
        lastName: l.lastName || "-",
        familyAccountId: l.familyAccountId,
        familyName: l.familyAccount?.familyName ?? null,
        admissionNo: l.admissionNo ?? null,
        createdAt: l.createdAt,
        balance,
        lastInvoice: lastInvoiceAmount(ledger, l.id, accountNo),
        lastPayment: lastPaymentAmount(ledger, l.id, accountNo),
      };
    });

    return res.json({ success: true, accounts });
  } catch (error) {
    console.error("[payments] GET /accounts failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || "").trim();
    const learnerId = String(body.learnerId || body.parentId || body.accountId || "").trim();
    const accountNo = String(body.accountNo || "").trim();
    const amount = normaliseAmount(body.amount);

    if (!schoolId || !amount) {
      return res.status(400).json({ success: false, error: "Missing schoolId or amount" });
    }

    const entry: BillingLedgerEntry = {
      id: String(body.id || `pay-${Date.now()}`),
      schoolId,
      learnerId,
      accountNo,
      type: "payment",
      amount,
      date: String(body.date || body.paidAt || new Date().toISOString()).slice(0, 10),
      reference: String(body.reference || "").trim(),
      description: String(body.description || "Payment").trim(),
      method: String(body.method || body.type || "").trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    appendSchoolEntry(schoolId, entry);
    return res.json({ success: true, payment: entry });
  } catch (error) {
    console.error("[payments] POST / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
