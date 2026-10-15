import { Router, type Request } from "express";

import { prisma } from "../prisma";
import {
  BillingUndoError,
  undoBillingTransaction,
  type UndoBillingTransactionActor,
} from "../services/billingTransactionUndo";
import {
  CreditNoteError,
  issueInvoiceLineCreditNote,
  reverseInvoiceLineCreditNote,
} from "../services/invoiceLineCreditNote";
import { verifyStaffJwt } from "../utils/staffJwt";
import { getUserAccessMeta } from "../utils/userAccessStore";
import { appRoleFromPrismaRole } from "../utils/userPermissions";

const router = Router();

/** Staff actor for audit + payment-undo role checks (same role source as invoice run undo). */
async function resolveUndoActor(req: Request, schoolId: string): Promise<UndoBillingTransactionActor | null> {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload?.userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, schoolId: true, role: true, isActive: true, email: true },
  });
  if (!user?.isActive || String(user.schoolId) !== schoolId) return null;
  const meta = await getUserAccessMeta(user.id);
  const appRole = String(meta?.appRole || appRoleFromPrismaRole(user.role)).trim();
  return { userId: user.id, email: user.email || undefined, appRole };
}

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

    const actor = await resolveUndoActor(req, schoolId);

    const result = await undoBillingTransaction({
      schoolId,
      transactionId,
      accountNo,
      auditNo: auditNo as string | number | undefined,
      actor,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      confirm: body.confirm === true,
      expectedAmount: (body.expectedAmount ?? null) as number | string | null,
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
    if (error instanceof BillingUndoError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    const message = error instanceof Error ? error.message : "Server error";
    const blocked = message.includes("cannot be undone");
    console.error("[billing-transactions] POST /:id/undo failed:", error);
    return res.status(blocked ? 403 : 500).json({ success: false, error: message });
  }
});

// POST /api/billing-transactions/:id/credit-note — credit one charge line of an invoice
router.post("/:id/credit-note", async (req, res) => {
  try {
    const invoiceId = String(req.params.id || "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || req.query.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const actor = await resolveUndoActor(req, schoolId);
    const result = issueInvoiceLineCreditNote({
      schoolId,
      invoiceId,
      lineKey: String(body.lineKey || "").trim(),
      actor,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      confirm: body.confirm === true,
      expectedAmount: (body.expectedAmount ?? null) as number | string | null,
      expectedDescription: typeof body.expectedDescription === "string" ? body.expectedDescription : null,
    });

    return res.json({
      success: true,
      invoice: result.invoice,
      creditNote: result.creditNote,
      alreadyIssued: result.alreadyIssued,
      ledgerEntries: result.ledgerEntries,
    });
  } catch (error) {
    if (error instanceof CreditNoteError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    console.error("[billing-transactions] POST /:id/credit-note failed:", error);
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(500).json({ success: false, error: message });
  }
});

// POST /api/billing-transactions/:id/credit-note/reverse — audited reversal of an EduClear credit note
router.post("/:id/credit-note/reverse", async (req, res) => {
  try {
    const creditNoteId = String(req.params.id || "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || req.query.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const actor = await resolveUndoActor(req, schoolId);
    const result = reverseInvoiceLineCreditNote({
      schoolId,
      creditNoteId,
      actor,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      confirm: body.confirm === true,
      expectedAmount: (body.expectedAmount ?? null) as number | string | null,
    });

    return res.json({
      success: true,
      creditNote: result.creditNote,
      correction: result.correction,
      alreadyReversed: result.alreadyReversed,
      ledgerEntries: result.ledgerEntries,
    });
  } catch (error) {
    if (error instanceof CreditNoteError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    console.error("[billing-transactions] POST /:id/credit-note/reverse failed:", error);
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
