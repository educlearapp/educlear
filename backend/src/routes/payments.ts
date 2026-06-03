import { Router } from "express";

import { relinkSchoolBillingLedger } from "../services/billingLedgerRelink";
import { resolveBillingAccountRef } from "../services/resolveBillingAccountRef";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  resolveAuthoritativeAccountBalance,
  type BillingStatementAccountRow,
} from "../services/statementAccounts";
import {
  isEduClearUndoCorrectionEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  appendSchoolEntrySafe,
  computeOpenInvoiceLines,
  listPayments,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

function activeLedgerEntriesForAccount(
  ledger: BillingLedgerEntry[],
  accountRef: string
): BillingLedgerEntry[] {
  const ref = String(accountRef || "").trim().toUpperCase();
  return ledger.filter((entry) => {
    if (String(entry.accountNo || "").trim().toUpperCase() !== ref) return false;
    if (isUndoneLedgerEntry(entry)) return false;
    if (isEduClearUndoCorrectionEntry(entry)) return false;
    return true;
  });
}

const router = Router();

function collectAccountLedgerSlice(
  ledger: BillingLedgerEntry[],
  accountRef: string
): BillingLedgerEntry[] {
  const ref = String(accountRef || "").trim().toUpperCase();
  return ledger.filter(
    (entry) => String(entry.accountNo || "").trim().toUpperCase() === ref
  );
}

function findAccountRow(
  accounts: BillingStatementAccountRow[],
  accountRef: string
): BillingStatementAccountRow | null {
  const ref = String(accountRef || "").trim().toUpperCase();
  return (
    accounts.find((row) => String(row.accountNo || "").trim().toUpperCase() === ref) ??
    null
  );
}

// GET /api/payments/env — cross-device billing diagnostics
router.get("/env", async (_req, res) => {
  try {
    const dbUrl = String(process.env.DATABASE_URL || "").trim();
    let databaseHost = "—";
    if (dbUrl) {
      try {
        databaseHost = new URL(dbUrl.replace(/^postgres(ql)?:\/\//i, "https://")).hostname;
      } catch {
        databaseHost = "configured";
      }
    }
    return res.json({
      success: true,
      nodeEnv: process.env.NODE_ENV || "development",
      databaseHost,
      gitCommit: process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || "—",
      ledgerStore: "billing-ledger.json",
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[payments] GET /env failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

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
      message: entry.description,
      note: entry.description,
      notes: entry.description,
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
    const accountRef = String(accountNo || "").trim().toUpperCase();
    const scoped = activeLedgerEntriesForAccount(ledger, accountRef);
    const openInvoices = computeOpenInvoiceLines(scoped, "", accountRef);
    const balance = await resolveAuthoritativeAccountBalance(schoolId, accountRef, { ledger });

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

    const paymentNote = String(
      body.message || body.note || body.notes || body.description || "Payment"
    ).trim();

    const paymentDate = String(body.date || body.paidAt || new Date().toISOString()).slice(0, 10);
    const paymentMethod = String(body.method || body.type || "").trim() || undefined;
    const paymentReference = String(body.reference || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();

    const entry: BillingLedgerEntry = {
      id: String(body.id || "").trim() || `pay-${Date.now()}`,
      schoolId,
      learnerId: "",
      accountNo: resolved.accountRef,
      type: "payment",
      amount,
      date: paymentDate,
      reference: paymentReference,
      description: paymentNote || "Payment",
      method: paymentMethod,
      source: "manual",
      createdAt: new Date().toISOString(),
    };

    const appendResult = appendSchoolEntrySafe(schoolId, entry, { idempotencyKey });
    const savedEntry = appendResult.entry;

    await relinkSchoolBillingLedger(schoolId);
    const ledger = readSchoolLedger(schoolId);
    const accountRef = resolved.accountRef;
    const balance = await resolveAuthoritativeAccountBalance(schoolId, accountRef, {
      ledger,
    });
    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
    const account = findAccountRow(accounts, accountRef);
    const ledgerEntries = collectAccountLedgerSlice(ledger, accountRef);
    const openInvoices = computeOpenInvoiceLines(
      activeLedgerEntriesForAccount(ledger, accountRef),
      "",
      accountRef
    );

    const outstandingTotal = accounts.reduce(
      (sum, row) => sum + (Number(row.balance) > 0 ? Number(row.balance) : 0),
      0
    );
    const recentlyOwing = accounts.filter((row) => {
      const b = Number(row.balance) || 0;
      return b > 0 && b <= 10000;
    }).length;
    const badDebt = accounts.filter((row) => (Number(row.balance) || 0) > 10000).length;

    return res.json({
      success: true,
      duplicate: !appendResult.created,
      duplicateReason: appendResult.duplicateReason,
      payment: {
        ...savedEntry,
        message: savedEntry.description,
        note: savedEntry.description,
        notes: savedEntry.description,
      },
      balance,
      account,
      lastPayment: account?.lastPayment ?? 0,
      lastPaymentDate: account?.lastPaymentDate ?? "",
      ledgerEntries,
      openInvoices,
      statements: accounts,
      summary: {
        accountsCount: accounts.length,
        totalOutstanding: Math.round(outstandingTotal * 100) / 100,
        recentlyOwing,
        badDebt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[payments] POST / failed:", error);
    const busy = message.includes("Billing ledger is busy");
    return res.status(busy ? 503 : 500).json({ success: false, error: message });
  }
});

export default router;
