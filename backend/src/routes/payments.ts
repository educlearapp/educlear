import { Router } from "express";

import { relinkSchoolBillingLedger } from "../services/billingLedgerRelink";
import { resolveBillingAccountRef } from "../services/resolveBillingAccountRef";
import { buildAccountsFromAgeAnalysisSnapshots } from "../services/statementAccounts";
import {
  appendSchoolEntry,
  calculateBalanceForAccount,
  computeOpenInvoiceLines,
  listPayments,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const router = Router();

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
      bankTransactionId: entry.bankTransactionId,
      bankImportId: entry.bankImportId,
      source: entry.source,
      createdAt: entry.createdAt,
    }));

    return res.json({ success: true, payments });
  } catch (error) {
    console.error("[payments] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/payments/open-invoices?schoolId=&learnerId=&accountNo=
router.get("/open-invoices", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    const learnerId = typeof req.query?.learnerId === "string" ? String(req.query.learnerId) : "";
    const accountNo = typeof req.query?.accountNo === "string" ? String(req.query.accountNo) : "";
    if (!schoolId || !accountNo) {
      return res.status(400).json({
        success: false,
        error: "Missing schoolId or accountNo",
      });
    }

    await relinkSchoolBillingLedger(schoolId);
    const ledger = readSchoolLedger(schoolId);
    // Identity is accountRef only for open invoice allocation + balance snapshots.
    const openInvoices = computeOpenInvoiceLines(ledger, "", accountNo);
    const balance = calculateBalanceForAccount(ledger, "", accountNo);

    return res.json({ success: true, openInvoices, balance });
  } catch (error) {
    console.error("[payments] GET /open-invoices failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/payments/accounts?schoolId=...
router.get("/accounts", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);

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
    const accountInput = String(body.accountNo || body.accountRef || "").trim();
    const amount = normaliseAmount(body.amount);

    if (!schoolId || !amount) {
      return res.status(400).json({ success: false, error: "Missing schoolId or amount" });
    }
    if (!accountInput) {
      return res.status(400).json({ success: false, error: "Missing accountNo" });
    }

    const resolved = await resolveBillingAccountRef(schoolId, accountInput);
    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: `Account not found for ref ${accountInput}`,
      });
    }

    const entry: BillingLedgerEntry = {
      id: String(body.id || `pay-${Date.now()}`),
      schoolId,
      learnerId: "",
      accountNo: resolved.accountRef,
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
