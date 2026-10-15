import { Router, type Request } from "express";

import { prisma } from "../prisma";
import {
  BillingUndoError,
  undoBillingTransaction,
  type UndoBillingTransactionActor,
} from "../services/billingTransactionUndo";
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

export default router;
