/**
 * Owner-only EduClock → Payroll import routes + finalize/reopen.
 */
import { Router, type Request, type Response } from "express";
import {
  evaluateOwnerSchoolAuth,
  loadStaffSchoolAuth,
  type StaffSchoolAuth,
} from "../middleware/requireOwnerSchoolAccess";
import {
  confirmEduClockImport,
  getCurrentEduClockImport,
  previewEduClockImport,
  recalculateEduClockImport,
  PayrollEduClockImportError,
} from "../services/payrollEduClockImportService";
import {
  finalizePayrollRun,
  reopenPayrollRun,
  PayrollLockError,
} from "../services/payrollRunLockService";

const router = Router();

type AuthedRequest = Request & { ownerAuth?: StaffSchoolAuth };

async function requireOwner(req: AuthedRequest, res: Response): Promise<StaffSchoolAuth | null> {
  const auth = await loadStaffSchoolAuth(req.headers.authorization);
  // Prefer school from body/query but never trust it over auth
  const requested =
    String((req.body && req.body.schoolId) || req.query.schoolId || auth?.authorizedSchoolId || "").trim();
  const decision = evaluateOwnerSchoolAuth({
    auth,
    requestSchoolId: requested || (auth?.authorizedSchoolId ?? ""),
    deniedMessage: "EduClock payroll import is restricted to the school Owner",
  });
  if (!decision.allowed) {
    res.status(decision.status).json({ error: decision.error, code: "OWNER_REQUIRED" });
    return null;
  }
  req.ownerAuth = decision.auth;
  return decision.auth;
}

function sendServiceError(res: Response, err: unknown) {
  if (err instanceof PayrollEduClockImportError || err instanceof PayrollLockError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: (err as PayrollEduClockImportError).details,
    });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal payroll import error" });
}

/** POST /educlock-import/preview — read-only, zero writes */
router.post("/educlock-import/preview", async (req, res) => {
  try {
    const auth = await requireOwner(req, res);
    if (!auth) return;
    const body = req.body || {};
    const result = await previewEduClockImport({
      schoolId: auth.authorizedSchoolId,
      payrollRunId: body.payrollRunId ? String(body.payrollRunId) : null,
      payrollMonth: body.payrollMonth != null ? Number(body.payrollMonth) : undefined,
      payrollYear: body.payrollYear != null ? Number(body.payrollYear) : undefined,
    });
    return res.json({ success: true, preview: result });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

/** POST /educlock-import/confirm — atomic confirm of run-bound preview */
router.post("/educlock-import/confirm", async (req, res) => {
  try {
    const auth = await requireOwner(req, res);
    if (!auth) return;
    const body = req.body || {};
    const result = await confirmEduClockImport({
      schoolId: auth.authorizedSchoolId,
      payrollRunId: String(body.payrollRunId || ""),
      previewHash: String(body.previewHash || ""),
      actorUserId: auth.userId,
    });
    return res.json({
      success: true,
      idempotent: result.idempotent,
      import: result.import,
    });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

/** POST /educlock-import/recalculate */
router.post("/educlock-import/recalculate", async (req, res) => {
  try {
    const auth = await requireOwner(req, res);
    if (!auth) return;
    const body = req.body || {};
    const result = await recalculateEduClockImport({
      schoolId: auth.authorizedSchoolId,
      payrollRunId: String(body.payrollRunId || ""),
      previousConfirmedImportId: String(body.previousConfirmedImportId || ""),
      previewHash: String(body.previewHash || ""),
      actorUserId: auth.userId,
      reason: String(body.reason || ""),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

/** GET /educlock-import/current */
router.get("/educlock-import/current", async (req, res) => {
  try {
    const auth = await requireOwner(req, res);
    if (!auth) return;
    const payrollRunId = req.query.payrollRunId ? String(req.query.payrollRunId) : undefined;
    const payrollMonth = req.query.payrollMonth != null ? Number(req.query.payrollMonth) : undefined;
    const payrollYear = req.query.payrollYear != null ? Number(req.query.payrollYear) : undefined;
    const current = await getCurrentEduClockImport({
      schoolId: auth.authorizedSchoolId,
      payrollRunId,
      payrollMonth,
      payrollYear,
    });
    return res.json({ success: true, import: current });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

/** POST /run/:payrollRunId/finalize */
router.post("/run/:payrollRunId/finalize", async (req, res) => {
  try {
    const auth = await requireOwner(req, res);
    if (!auth) return;
    const run = await finalizePayrollRun({
      schoolId: auth.authorizedSchoolId,
      payrollRunId: String(req.params.payrollRunId || ""),
      actorUserId: auth.userId,
      note: req.body?.note != null ? String(req.body.note) : null,
    });
    return res.json({ success: true, payrollRun: run });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

/** POST /run/:payrollRunId/reopen */
router.post("/run/:payrollRunId/reopen", async (req, res) => {
  try {
    const auth = await requireOwner(req, res);
    if (!auth) return;
    const run = await reopenPayrollRun({
      schoolId: auth.authorizedSchoolId,
      payrollRunId: String(req.params.payrollRunId || ""),
      actorUserId: auth.userId,
      reason: String(req.body?.reason || ""),
    });
    return res.json({ success: true, payrollRun: run });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

export default router;
