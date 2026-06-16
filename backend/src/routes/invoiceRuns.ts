import { Router } from "express";

import { executeInvoiceRun } from "../services/invoiceRunExecuteService";

const router = Router();

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

export default router;
