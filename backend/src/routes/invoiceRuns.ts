import { Router } from "express";

import {
  requireInvoiceRunExecuteAuth,
  requireInvoiceRunPreviewAuth,
  type InvoiceRunExecuteAuthRequest,
} from "../middleware/requireInvoiceRunExecuteAuth";
import {
  requireInvoiceRunUndoAuth,
  type InvoiceRunUndoRequest,
} from "../middleware/requireInvoiceRunUndoAuth";
import { executeInvoiceRun } from "../services/invoiceRunExecuteService";
import {
  countInvoicesByPeriod,
  getInvoiceRunDetailFromLedger,
  listInvoiceRunsFromLedger,
} from "../services/invoiceRunListService";
import {
  INVOICE_RUN_STATEMENT_DEFAULT_PERIOD,
  buildInvoiceRunStatementsPdf,
  invoiceRunStatementCutoffNote,
} from "../services/invoiceRunStatementsPdfService";
import { undoInvoiceRun } from "../services/invoiceRunUndoService";
import { readSchoolLedger } from "../utils/billingLedgerStore";
import { toAsciiHttpHeaderValue } from "../utils/httpHeaderAscii";

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

/**
 * GET /api/invoice-runs/:runId/invoices?schoolId=
 * Read-only completed-run detail (invoices + unique family accounts).
 */
router.get(
  "/:runId/invoices",
  requireInvoiceRunPreviewAuth,
  async (req: InvoiceRunExecuteAuthRequest, res) => {
    try {
      const schoolId = String(req.invoiceRunExecuteAuth?.authorizedSchoolId || "").trim();
      const runId = decodeURIComponent(String(req.params?.runId || "").trim());
      if (!schoolId || !runId) {
        return res.status(400).json({ success: false, error: "Missing schoolId or runId" });
      }

      const ledger = readSchoolLedger(schoolId);
      const detail = getInvoiceRunDetailFromLedger(schoolId, runId, { ledger });
      if (!detail) {
        return res.status(404).json({
          success: false,
          error: "Invoice run not found for this school",
          errorCode: "NOT_FOUND",
        });
      }

      return res.json({
        ...detail,
        success: true,
        source: "billing-ledger.json",
        statementCutoffNote: invoiceRunStatementCutoffNote(
          detail.invoicePeriod || detail.period,
          INVOICE_RUN_STATEMENT_DEFAULT_PERIOD
        ),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server error";
      console.error("[invoice-runs] GET /:runId/invoices failed:", error);
      return res.status(500).json({ success: false, error: message });
    }
  }
);

/**
 * GET /api/invoice-runs/:runId/statements.pdf?schoolId=
 * Combined printable PDF — one statement per unique family account on the run.
 */
router.get(
  "/:runId/statements.pdf",
  requireInvoiceRunPreviewAuth,
  async (req: InvoiceRunExecuteAuthRequest, res) => {
    try {
      const schoolId = String(req.invoiceRunExecuteAuth?.authorizedSchoolId || "").trim();
      const runId = decodeURIComponent(String(req.params?.runId || "").trim());
      const periodRaw =
        typeof req.query?.period === "string" ? String(req.query.period).trim() : "";
      if (!schoolId || !runId) {
        return res.status(400).json({ success: false, error: "Missing schoolId or runId" });
      }

      const ledger = readSchoolLedger(schoolId);
      const built = await buildInvoiceRunStatementsPdf({
        schoolId,
        runId,
        period: periodRaw || undefined,
        ledger,
      });
      if (!built) {
        return res.status(404).json({
          success: false,
          error: "No family account statements found for this invoice run",
          errorCode: "NOT_FOUND",
        });
      }

      res.setHeader("Content-Type", "application/pdf");
      // attachment → direct download in Safari/Chrome without a pop-up window.
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${toAsciiHttpHeaderValue(built.filename, "statements.pdf")}"`
      );
      res.setHeader("Content-Length", String(built.buffer.length));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-EduClear-Statement-Count", String(built.statementCount));
      res.setHeader("X-EduClear-Invoice-Count", String(built.detail.totalInvoices));
      res.setHeader(
        "X-EduClear-Statement-Period",
        toAsciiHttpHeaderValue(built.statementPeriod, "Last 3 Months")
      );
      // ASCII-only ISO window — human en-dash labels belong in the PDF body, not headers.
      res.setHeader(
        "X-EduClear-Statement-Window",
        toAsciiHttpHeaderValue(built.statementWindowHeader, "All Time")
      );
      res.setHeader(
        "X-EduClear-Statement-Cutoff-Note",
        toAsciiHttpHeaderValue(built.statementCutoffNote, "ok")
      );
      // Send only after the full combined PDF is built — never stream a partial merge.
      return res.status(200).send(built.buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server error";
      const unsupported = /Unsupported statement period/i.test(message);
      console.error("[invoice-runs] GET /:runId/statements.pdf failed:", error);
      return res.status(unsupported ? 400 : 500).json({
        success: false,
        error: message,
        errorCode: unsupported ? "UNSUPPORTED_PERIOD" : "SERVER_ERROR",
      });
    }
  }
);

async function handleExecute(req: InvoiceRunExecuteAuthRequest, res: any, dryRun: boolean) {
  try {
    const body = req.body ?? {};
    const schoolId = String(req.invoiceRunExecuteAuth?.authorizedSchoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({
        success: false,
        error: "Missing school authorization",
        errorCode: "INVALID_REQUEST",
      });
    }

    const result = await executeInvoiceRun({
      schoolId,
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

router.post("/execute", requireInvoiceRunExecuteAuth, (req: InvoiceRunExecuteAuthRequest, res) =>
  handleExecute(req, res, req.body?.dryRun === true)
);

router.post("/preview", requireInvoiceRunPreviewAuth, (req: InvoiceRunExecuteAuthRequest, res) =>
  handleExecute(req, res, true)
);

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
