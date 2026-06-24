import { Router } from "express";

import { resolveBillingAccountRef } from "../services/resolveBillingAccountRef";
import { relinkSchoolBillingLedger } from "../services/billingLedgerRelink";
import { resolveAuthoritativeAccountBalance } from "../services/statementAccounts";
import { generatePaymentReceiptPdfBuffer } from "../services/receiptEmailService";
import {
  computeOpenInvoiceLines,
  listPayments,
  normaliseAmount,
  readSchoolLedger,
  type OpenInvoiceLine,
} from "../utils/billingLedgerStore";
import {
  clearPaymentAllocations as clearStoredAllocations,
  listPaymentAllocations,
  writePaymentAllocations,
  type StoredPaymentAllocation,
} from "../utils/paymentAllocationStore";

const router = Router();

const FEE_CATEGORY_LABELS: Record<string, string> = {
  registration: "Registration",
  school_fees: "School Fees",
  transport: "Transport",
  leadership_camp: "Leadership Camp",
  uniform: "Uniform",
  stationery: "Stationery",
  aftercare: "Aftercare",
  other_fees: "Other Fees",
  account_credit: "Account Credit",
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function feeCategoryLabel(key: string | null | undefined): string {
  const k = String(key || "").trim();
  if (!k) return "Allocation";
  return FEE_CATEGORY_LABELS[k] || k.replace(/_/g, " ");
}

async function resolveAccountFromRequest(
  schoolId: string,
  accountNo: string
): Promise<{ accountRef: string } | null> {
  const resolved = await resolveBillingAccountRef(schoolId, accountNo);
  if (!resolved) return null;
  return { accountRef: resolved.accountRef };
}

function loadOpenInvoices(schoolId: string, accountRef: string): OpenInvoiceLine[] {
  const ledger = readSchoolLedger(schoolId);
  return computeOpenInvoiceLines(ledger, "", accountRef);
}

function fifoSuggest(openInvoices: OpenInvoiceLine[], paymentAmount: number) {
  let remaining = roundMoney(paymentAmount);
  const suggestions: { invoiceId: string; allocatedAmount: number }[] = [];
  for (const inv of openInvoices) {
    if (remaining <= 0.001) break;
    const unpaid = roundMoney(Number(inv.unpaid || 0));
    if (unpaid <= 0.001) continue;
    const allocatedAmount = roundMoney(Math.min(unpaid, remaining));
    if (allocatedAmount <= 0.001) continue;
    suggestions.push({ invoiceId: inv.id, allocatedAmount });
    remaining = roundMoney(remaining - allocatedAmount);
  }
  return suggestions;
}

function mapAllocationRows(rows: StoredPaymentAllocation[]) {
  return rows.map((row) => ({
    id: row.id,
    paymentId: row.paymentId,
    invoiceId: row.invoiceId,
    feeCategory: row.feeCategory,
    feeCategoryLabel: feeCategoryLabel(row.feeCategory),
    allocatedAmount: row.allocatedAmount,
  }));
}

function buildTargets(openInvoices: OpenInvoiceLine[], paymentAmount: number) {
  const invoices = openInvoices.map((inv) => ({
    id: inv.id,
    reference: inv.reference,
    description: inv.description,
    date: inv.date,
    dueDate: inv.date,
    amount: inv.amount,
    unpaid: inv.unpaid,
    overdue: false,
    categories: ["school_fees"] as const,
  }));
  const totalOutstanding = roundMoney(
    openInvoices.reduce((sum, inv) => sum + Number(inv.unpaid || 0), 0)
  );
  const suggestedTotal = roundMoney(
    fifoSuggest(openInvoices, paymentAmount).reduce((s, line) => s + line.allocatedAmount, 0)
  );
  const accountCredit = roundMoney(Math.max(0, paymentAmount - suggestedTotal));
  return {
    paymentAmount,
    invoices,
    categories: [] as {
      feeCategory: string;
      label: string;
      outstanding: number;
      overdue: number;
    }[],
    totalOutstanding,
    accountCredit,
  };
}

// GET /api/payment-allocations/targets?schoolId=&accountNo=&paymentAmount=&paymentId=
router.get("/targets", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    const accountNo =
      typeof req.query?.accountNo === "string" ? String(req.query.accountNo) : "";
    const paymentId =
      typeof req.query?.paymentId === "string" ? String(req.query.paymentId) : "";
    const paymentAmount = normaliseAmount(req.query?.paymentAmount);

    if (!schoolId || !accountNo) {
      return res.status(400).json({ success: false, error: "Missing schoolId or accountNo" });
    }

    const account = await resolveAccountFromRequest(schoolId, accountNo);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }

    await relinkSchoolBillingLedger(schoolId);
    const openInvoices = loadOpenInvoices(schoolId, account.accountRef);
    const targets = buildTargets(openInvoices, paymentAmount);
    const existingAllocations = paymentId
      ? listPaymentAllocations(schoolId, paymentId)
      : [];
    const balance = await resolveAuthoritativeAccountBalance(schoolId, account.accountRef);

    return res.json({
      success: true,
      targets,
      needsAllocation:
        paymentAmount > 0.001 &&
        (targets.invoices.length > 0 || targets.categories.length > 0),
      existingAllocations: mapAllocationRows(existingAllocations),
      balance,
      accountCredit: targets.accountCredit,
    });
  } catch (error) {
    console.error("[payment-allocations] GET /targets failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/payment-allocations/suggest
router.post("/suggest", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || "").trim();
    const accountNo = String(body.accountNo || body.accountRef || "").trim();
    const paymentAmount = normaliseAmount(body.paymentAmount);

    if (!schoolId || !accountNo || paymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Missing schoolId, accountNo, or paymentAmount",
      });
    }

    const account = await resolveAccountFromRequest(schoolId, accountNo);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }

    await relinkSchoolBillingLedger(schoolId);
    const openInvoices = loadOpenInvoices(schoolId, account.accountRef);
    const suggestions = fifoSuggest(openInvoices, paymentAmount);
    const targets = buildTargets(openInvoices, paymentAmount);

    return res.json({ success: true, suggestions, targets });
  } catch (error) {
    console.error("[payment-allocations] POST /suggest failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/payment-allocations/:paymentId
router.post("/:paymentId", async (req, res) => {
  try {
    const paymentId = String(req.params.paymentId || "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || "").trim();
    const accountNo = String(body.accountNo || body.accountRef || "").trim();
    const paymentAmount = normaliseAmount(body.paymentAmount);
    const allocatedBy = String(body.allocatedBy || "").trim() || undefined;
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!schoolId || !paymentId || !accountNo) {
      return res.status(400).json({
        success: false,
        error: "Missing schoolId, paymentId, or accountNo",
      });
    }

    const account = await resolveAccountFromRequest(schoolId, accountNo);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }

    const payment = listPayments(schoolId).find((p) => p.id === paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    const payAccount = String(payment.accountNo || "").trim().toUpperCase();
    if (payAccount && payAccount !== account.accountRef) {
      return res.status(400).json({
        success: false,
        error: "Payment does not belong to this account",
      });
    }

    const effectivePaymentAmount =
      paymentAmount > 0 ? paymentAmount : normaliseAmount(payment.amount);
    let allocatedTotal = 0;
    const stored: StoredPaymentAllocation[] = [];
    const createdAt = new Date().toISOString();

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] as Record<string, unknown>;
      const allocatedAmount = roundMoney(normaliseAmount(line.allocatedAmount));
      if (allocatedAmount <= 0.001) continue;
      allocatedTotal = roundMoney(allocatedTotal + allocatedAmount);
      stored.push({
        id: `palloc-${paymentId}-${i}-${Date.now()}`,
        paymentId,
        schoolId,
        accountRef: account.accountRef,
        invoiceId: line.invoiceId ? String(line.invoiceId).trim() : null,
        feeCategory: line.feeCategory ? String(line.feeCategory).trim() : null,
        allocatedAmount,
        allocatedBy,
        createdAt,
      });
    }

    if (allocatedTotal > effectivePaymentAmount + 0.01) {
      return res.status(400).json({
        success: false,
        error: "Total allocation exceeds payment amount",
      });
    }

    writePaymentAllocations(schoolId, paymentId, stored);

    return res.json({
      success: true,
      allocations: mapAllocationRows(stored),
      accountRef: account.accountRef,
    });
  } catch (error) {
    console.error("[payment-allocations] POST /:paymentId failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /api/payment-allocations/:paymentId?schoolId=
router.delete("/:paymentId", async (req, res) => {
  try {
    const paymentId = String(req.params.paymentId || "").trim();
    const schoolId =
      typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId || !paymentId) {
      return res.status(400).json({ success: false, error: "Missing schoolId or paymentId" });
    }
    clearStoredAllocations(schoolId, paymentId);
    return res.json({ success: true });
  } catch (error) {
    console.error("[payment-allocations] DELETE /:paymentId failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/payment-allocations/:paymentId/receipt/pdf?schoolId=
router.get("/:paymentId/receipt/pdf", async (req, res) => {
  try {
    const paymentId = String(req.params.paymentId || "").trim();
    const schoolId =
      typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId || !paymentId) {
      return res.status(400).json({ success: false, error: "Missing schoolId or paymentId" });
    }

    const payment = listPayments(schoolId).find((p) => p.id === paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    const allocations = listPaymentAllocations(schoolId, paymentId);
    const pdfBuffer = await generatePaymentReceiptPdfBuffer({ schoolId, payment, allocations });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="receipt-${paymentId}.pdf"`
    );
    res.end(pdfBuffer);
    return undefined;
  } catch (error) {
    console.error("[payment-allocations] GET receipt/pdf failed:", error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: "Server error" });
    }
    return undefined;
  }
});

export default router;
