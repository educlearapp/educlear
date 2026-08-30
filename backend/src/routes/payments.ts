import { Router } from "express";

import {
  requireCapturePaymentAuth,
  requireCapturePaymentReadAuth,
  type CapturePaymentAuthRequest,
} from "../middleware/requireCapturePaymentAuth";
import { relinkSchoolBillingLedger } from "../services/billingLedgerRelink";
import { sendSavedPaymentReceiptEmail } from "../services/receiptEmailService";
import { captureManualPayment, CapturePaymentError } from "../services/capturePaymentService";
import { buildSetupRequiredPayload } from "../services/schoolEmailService";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  resolveAuthoritativeAccountBalance,
} from "../services/statementAccounts";
import {
  isEduClearUndoCorrectionEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  computeOpenInvoiceLines,
  listPayments,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  collectBillingPersistenceDiagnostics,
  getPaymentWriteGuard,
} from "../utils/billingPersistenceDiagnostics";

const router = Router();

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

function resolveDatabaseHost(): string {
  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  if (!dbUrl) return "—";
  try {
    return new URL(dbUrl.replace(/^postgres(ql)?:\/\//i, "https://")).hostname;
  } catch {
    return "configured";
  }
}

// GET /api/payments/env — cross-device billing diagnostics
router.get("/env", async (_req, res) => {
  try {
    return res.json({
      success: true,
      nodeEnv: process.env.NODE_ENV || "development",
      databaseHost: resolveDatabaseHost(),
      gitCommit: process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || "—",
      ledgerStore: "billing-ledger.json",
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[payments] GET /env failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/payments/env/full — billing persistence / disk diagnostics (temporary ops endpoint)
router.get("/env/full", async (_req, res) => {
  try {
    const diagnostics = collectBillingPersistenceDiagnostics();
    return res.json({
      ...diagnostics,
      databaseHost: resolveDatabaseHost(),
    });
  } catch (error) {
    console.error("[payments] GET /env/full failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/payments?schoolId=...
router.get("/", requireCapturePaymentReadAuth, async (req: CapturePaymentAuthRequest, res) => {
  try {
    const schoolId = String(req.capturePaymentAuth?.authorizedSchoolId || "").trim();
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });

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
router.get("/open-invoices", requireCapturePaymentReadAuth, async (req: CapturePaymentAuthRequest, res) => {
  try {
    const schoolId = String(req.capturePaymentAuth?.authorizedSchoolId || "").trim();
    const learnerId = typeof req.query?.learnerId === "string" ? String(req.query.learnerId) : "";
    const accountNo = typeof req.query?.accountNo === "string" ? String(req.query.accountNo) : "";
    if (!schoolId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    if (!accountNo) {
      return res.status(400).json({
        success: false,
        error: "Missing accountNo",
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
router.get("/accounts", requireCapturePaymentReadAuth, async (req: CapturePaymentAuthRequest, res) => {
  try {
    const schoolId = String(req.capturePaymentAuth?.authorizedSchoolId || "").trim();
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);

    return res.json({ success: true, accounts });
  } catch (error) {
    console.error("[payments] GET /accounts failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/payments/:paymentId/send-receipt
router.post("/:paymentId/send-receipt", async (req, res) => {
  try {
    const paymentId = String(req.params.paymentId || "").trim();
    const schoolId = String(req.body?.schoolId || req.query?.schoolId || "").trim();
    if (!schoolId || !paymentId) {
      return res.status(400).json({ success: false, error: "Missing schoolId or paymentId" });
    }

    const result = await sendSavedPaymentReceiptEmail({ schoolId, paymentId });
    return res.json({
      success: true,
      message: "Receipt sent successfully.",
      ...result,
    });
  } catch (error) {
    console.error("[payments] POST /:paymentId/send-receipt failed:", error);
    const err = error as Error & { setupRequired?: boolean; noParentEmail?: boolean };
    if (err.noParentEmail || err.message === "No parent email found for this account.") {
      return res.status(404).json({
        success: false,
        error: "No parent email found for this account.",
      });
    }
    if (err.setupRequired) {
      return res.status(409).json({ success: false, ...buildSetupRequiredPayload() });
    }
    const status = err.message === "Payment not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      error: err.message || "Failed to send receipt email",
    });
  }
});

router.post("/", requireCapturePaymentAuth, async (req: CapturePaymentAuthRequest, res) => {
  try {
    const writeGuard = getPaymentWriteGuard();
    if (!writeGuard.allowed) {
      return res.status(503).json({
        success: false,
        error: writeGuard.reason || "Payment writes blocked — billing persistent disk not detected.",
        persistence: {
          persistentDiskDetected: writeGuard.diagnostics.persistentDiskDetected,
          dataDir: writeGuard.diagnostics.dataDir,
          dataDirResolvedPath: writeGuard.diagnostics.dataDirResolvedPath,
          expectedRenderMountPath: writeGuard.diagnostics.expectedRenderMountPath,
        },
      });
    }

    const auth = req.capturePaymentAuth;
    if (!auth) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await captureManualPayment({
      authorizedSchoolId: auth.authorizedSchoolId,
      familyAccountId: String(body.familyAccountId || "").trim(),
      amount: body.amount,
      date: body.date || body.paidAt,
      method: body.method || body.type,
      description: body.message || body.note || body.notes || body.description || "Payment",
      bankReference: body.bankReference || body.paymentReference || body.message,
      idempotencyKey: String(body.idempotencyKey || "").trim(),
      capturedByUserId: auth.userId,
      capturedByEmail: auth.email,
      capturedByName: auth.capturedByName,
      allocationLines: Array.isArray(body.allocationLines)
        ? (body.allocationLines as Array<{
            invoiceId?: string;
            feeCategory?: string;
            allocatedAmount: number;
          }>)
        : undefined,
    });

    const status = result.allocationSaved ? 200 : 207;
    return res.status(status).json(result);
  } catch (error) {
    if (error instanceof CapturePaymentError) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[payments] POST / failed:", error);
    const busy = message.includes("Billing ledger is busy");
    return res.status(busy ? 503 : 500).json({ success: false, error: message });
  }
});

export default router;
