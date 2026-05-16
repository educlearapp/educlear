import { Router } from "express";

import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  appendSchoolEntry,
  buildPenaltyEntryId,
  calculateBalanceForAccount,
  computeAccountOverdue,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const router = Router();

router.post("/preview", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || "").trim();
    const penaltyAmount = normaliseAmount(body.penaltyAmount ?? 300);
    const penaltyDate = String(body.penaltyDate || new Date().toISOString()).slice(0, 10);
    const dueDateCutoff = String(body.dueDateCutoff || penaltyDate).slice(0, 10);
    const excludeNotYetDue = Boolean(body.excludeNotYetDue);
    const applyToAll = body.applyTo !== "selected";
    const selectedAccountNos = Array.isArray(body.selectedAccountNos)
      ? body.selectedAccountNos.map((v) => String(v).trim())
      : [];

    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const ledger = readSchoolLedger(schoolId);
    const learners = await prisma.learner.findMany({
      where: { schoolId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        familyAccount: { select: { accountRef: true } },
      },
    });

    const description = String(body.description || "Late payment penalty").trim();
    const rows = learners
      .map((learner) => {
        const accountNo = resolveLearnerAccountNo(learner);
        if (!accountNo) return null;

        if (!applyToAll && !selectedAccountNos.includes(accountNo)) return null;

        const { balance, overdueAmount, excludedNotYetDue } = computeAccountOverdue(
          ledger,
          learner.id,
          accountNo,
          { penaltyDate, dueDateCutoff, excludeNotYetDue }
        );

        if (balance <= 0 || overdueAmount <= 0) return null;

        const penaltyId = buildPenaltyEntryId(schoolId, accountNo, penaltyDate, description);
        const alreadyApplied = ledger.some((e) => e.id === penaltyId);

        return {
          learnerId: learner.id,
          accountNo,
          learnerName: `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
          balance,
          overdueAmount,
          excludedNotYetDue,
          penaltyAmount,
          apply: !alreadyApplied,
          duplicate: alreadyApplied,
        };
      })
      .filter(Boolean);

    return res.json({ success: true, rows });
  } catch (error) {
    console.error("[billing/late-penalties] POST /preview failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/apply", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || "").trim();
    const penaltyAmount = normaliseAmount(body.penaltyAmount ?? 300);
    const penaltyDate = String(body.penaltyDate || new Date().toISOString()).slice(0, 10);
    const dueDate = String(body.dueDate || body.dueDateCutoff || penaltyDate).slice(0, 10);
    const description = String(body.description || "Late payment penalty").trim();
    const reference = String(body.reference || `PEN-${penaltyDate}`).trim();
    const accounts = Array.isArray(body.accounts) ? body.accounts : [];

    if (!schoolId || !accounts.length) {
      return res.status(400).json({ success: false, error: "Missing schoolId or accounts" });
    }

    const ledger = readSchoolLedger(schoolId);
    const applied: BillingLedgerEntry[] = [];
    const skipped: { accountNo: string; reason: string }[] = [];

    for (const row of accounts) {
      const learnerId = String((row as any)?.learnerId || "").trim();
      const accountNo = String((row as any)?.accountNo || "").trim();
      const apply = (row as any)?.apply !== false;
      if (!apply || !accountNo) {
        skipped.push({ accountNo: accountNo || "-", reason: "Not selected" });
        continue;
      }

      const balance = calculateBalanceForAccount(ledger, learnerId, accountNo);
      if (balance <= 0) {
        skipped.push({ accountNo, reason: "Paid up or overpaid" });
        continue;
      }

      const id = buildPenaltyEntryId(schoolId, accountNo, penaltyDate, description);
      if (ledger.some((e) => e.id === id)) {
        skipped.push({ accountNo, reason: "Duplicate penalty for date/description" });
        continue;
      }

      const entry: BillingLedgerEntry = {
        id,
        schoolId,
        learnerId,
        accountNo,
        type: "penalty",
        amount: penaltyAmount,
        date: penaltyDate,
        dueDate,
        reference,
        description,
        createdAt: new Date().toISOString(),
      };

      appendSchoolEntry(schoolId, entry);
      ledger.push(entry);
      applied.push(entry);
    }

    return res.json({ success: true, applied, skipped });
  } catch (error) {
    console.error("[billing/late-penalties] POST /apply failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
