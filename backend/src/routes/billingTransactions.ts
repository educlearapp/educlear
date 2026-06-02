import { Router } from "express";

import { undoBillingTransaction } from "../services/billingTransactionUndo";

const router = Router();

// POST /api/billing-transactions/:id/undo
router.post("/:id/undo", async (req, res) => {
  try {
    const transactionId = String(req.params.id || "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || req.query.schoolId || "").trim();
    const accountNo = String(body.accountNo || body.accountRef || req.query.accountNo || "").trim();
    const auditNo = body.auditNo ?? req.query.auditNo;

    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    if (!transactionId) {
      return res.status(400).json({ success: false, error: "Missing transaction id" });
    }

    const result = await undoBillingTransaction({
      schoolId,
      transactionId,
      accountNo,
      auditNo: auditNo as string | number | undefined,
    });

    return res.json({
      success: true,
      original: result.original,
      correction: result.correction,
      alreadyUndone: result.alreadyUndone,
      ledgerEntries: result.ledgerEntries,
      accounts: result.accounts,
      statements: result.accounts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const blocked = message.includes("cannot be undone");
    console.error("[billing-transactions] POST /:id/undo failed:", error);
    return res.status(blocked ? 403 : 500).json({ success: false, error: message });
  }
});

export default router;
