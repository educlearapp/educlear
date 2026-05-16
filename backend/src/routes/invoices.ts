import { Router } from "express";

import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  appendSchoolEntry,
  listInvoices,
  normaliseAmount,
  normaliseIsoDate,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const invoices = listInvoices(schoolId).map((entry) => ({
      id: entry.id,
      learnerId: entry.learnerId,
      accountNo: entry.accountNo,
      invoiceNumber: entry.reference,
      description: entry.description,
      amount: entry.amount,
      invoiceDate: entry.date,
      date: entry.date,
      dueDate: entry.dueDate,
      type: entry.type,
      reference: entry.reference,
      createdAt: entry.createdAt,
      runId: entry.runId,
    }));

    return res.json({ success: true, invoices });
  } catch (error) {
    console.error("[invoices] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || "").trim();
    const learnerId = String(body.learnerId || body.id || "").trim();
    const accountNo = String(body.accountNo || "").trim();
    const amount = normaliseAmount(body.amount);

    if (!schoolId || !learnerId || !amount) {
      return res.status(400).json({ success: false, error: "Missing schoolId, learnerId, or amount" });
    }

    const invoiceDate =
      normaliseIsoDate(body.date || body.invoiceDate) || new Date().toISOString().slice(0, 10);
    const dueDate =
      normaliseIsoDate(body.dueDate) || invoiceDate;

    const entry: BillingLedgerEntry = {
      id: String(body.id || `invoice-${Date.now()}`),
      schoolId,
      learnerId,
      accountNo: accountNo || resolveLearnerAccountNo(body as any),
      type: "invoice",
      amount,
      date: invoiceDate,
      dueDate,
      reference: String(body.reference || body.invoiceNumber || "").trim(),
      description: String(body.description || "Invoice").trim(),
      runId: body.runId ? String(body.runId) : undefined,
      createdAt: new Date().toISOString(),
    };

    appendSchoolEntry(schoolId, entry);
    return res.json({ success: true, invoice: entry });
  } catch (error) {
    console.error("[invoices] POST / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/ledger", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    return res.json({ success: true, entries: readSchoolLedger(schoolId) });
  } catch (error) {
    console.error("[invoices] GET /ledger failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
