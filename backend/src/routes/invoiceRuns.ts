import { Router } from "express";

import {
  requireInvoiceRunUndoAuth,
  type InvoiceRunUndoRequest,
} from "../middleware/requireInvoiceRunUndoAuth";
import { executeInvoiceRun } from "../services/invoiceRunExecuteService";
import {
  countInvoicesByPeriod,
  listInvoiceRunsFromLedger,
} from "../services/invoiceRunListService";
import { undoInvoiceRun } from "../services/invoiceRunUndoService";
import { readSchoolLedger } from "../utils/billingLedgerStore";

const router = Router();

// GET /api/invoice-runs?schoolId= — read-only list derived from billing ledger invoice rows
router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId).trim() : "";
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const ledger = readSchoolLedger(schoolId);
    const runs = listInvoiceRunsFromLedger(schoolId, { ledger });
    const invoicePeriodCounts = countInvoicesByPeriod(schoolId, { ledger });

    return res.json({
      success: true,
      runs,
      invoicePeriodCounts,
      source: "billing-ledger.json",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[invoice-runs] GET / failed:", error);
    return res.status(500).json({ success: false, error: message });
  }
});

async function handleExecute(req: { body?: Record<string, unknown> }, res: any, dryRun: boolean) {
  try {
    const body = req.body ?? {};

    const result = await executeInvoiceRun({
      schoolId: String(body.schoolId || "").trim(),
      runId: String(body.runId || "").trim(),
      invoicePeriod: String(body.invoicePeriod || body.month || body.period || "").trim(),
      invoiceDate: String(body.invoiceDate || body.date || "").trim(),
      dueDate: String(body.dueDate || "").trim() || undefined,
      description: String(body.description || "").trim() || undefined,
      dryRun,
      learnerIds: Array.isArray(body.learnerIds)
        ? body.learnerIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
        : undefined,
      extraFeesByLearnerId:
        body.extraFeesByLearnerId && typeof body.extraFeesByLearnerId === "object"
          ? (body.extraFeesByLearnerId as Record<string, { feeDescription: string; amount: number }[]>)
          : undefined,
    });

    if (!result.success && result.errorCode === "INTEGRITY_GATE_FAILED") {
      return res.status(422).json(result);
    }

    if (!result.success) {
      const status =
        result.errorCode === "INVALID_REQUEST"
          ? 400
          : result.errorCode === "DUPLICATE_RUN_ID"
            ? 409
            : 500;
      return res.status(status).json(result);
    }

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[invoice-runs] execute failed:", error);
    return res.status(500).json({ success: false, error: message });
  }
}

router.post("/execute", (req, res) => handleExecute(req, res, req.body?.dryRun === true));

router.post("/preview", (req, res) => handleExecute(req, res, true));

router.post("/:runId/undo", requireInvoiceRunUndoAuth, async (req: InvoiceRunUndoRequest, res) => {
  try {
    const runId = String(req.params?.runId || "").trim();
    const schoolId = String(req.invoiceRunUndoAuth?.authorizedSchoolId || "").trim();
    const body = req.body ?? {};
    if (!schoolId || !runId) {
      return res.status(400).json({
        success: false,
        error: "Missing schoolId or runId",
        errorCode: "INVALID_REQUEST",
      });
    }

    const result = undoInvoiceRun({
      schoolId,
      runId,
      expectedCount:
        typeof body.expectedCount === "number" ? Number(body.expectedCount) : undefined,
      expectedTotal:
        typeof body.expectedTotal === "number" ? Number(body.expectedTotal) : undefined,
    });

    if (!result.success) {
      const status =
        result.errorCode === "NOT_FOUND"
          ? 404
          : result.errorCode === "INVALID_REQUEST"
            ? 400
            : result.errorCode === "ALLOCATION_CONFLICT" ||
                result.errorCode === "AMBIGUOUS_RUN" ||
                result.errorCode === "COUNT_MISMATCH" ||
                result.errorCode === "TOTAL_MISMATCH"
              ? 409
              : result.errorCode?.includes("PRODUCTION") || result.error?.includes("production")
                ? 403
                : 500;
      return res.status(status).json(result);
    }

    const status = result.alreadyUndone ? 200 : 200;
    return res.status(status).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const productionBlocked = /disabled on production/i.test(message);
    console.error("[invoice-runs] undo failed:", error);
    return res.status(productionBlocked ? 403 : 500).json({
      success: false,
      error: message,
      errorCode: productionBlocked ? "PRODUCTION_UNDO_BLOCKED" : "UNDO_FAILED",
    });
  }
});

export default router;
