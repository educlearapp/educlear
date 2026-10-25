import { Router } from "express";
import type { CommunicationChannel, CommunicationMessageStatus } from "@prisma/client";
import { prisma } from "../prisma";
import {
  previewCommunicationQueueBatch,
  processCommunicationQueueBatch,
  retryCommunicationMessage,
} from "../communication/communicationQueue";
import { ensureDefaultCommunicationTemplates } from "../communication/communicationEngine";
import {
  evaluateStaffSchoolMatch,
  loadStaffSchoolAuth,
  type StaffSchoolAuth,
} from "../middleware/requireOwnerSchoolAccess";
import { isSchoolOwnerOrAdminRole } from "../utils/userPermissions";

const router = Router();

type AuthOk = { auth: StaffSchoolAuth; schoolId: string };

/**
 * Resolve authorised school from JWT user record — never trust a forged body/query schoolId
 * that does not match the staff user's school.
 */
async function requireEngineSchoolAccess(
  req: { headers: { authorization?: string }; query?: unknown; body?: unknown; params?: unknown },
  res: { status: (n: number) => { json: (b: unknown) => unknown } },
  opts?: { requireOwnerOrAdmin?: boolean }
): Promise<AuthOk | null> {
  const auth = await loadStaffSchoolAuth(req.headers.authorization);
  if (!auth) {
    res.status(401).json({ success: false, error: "Authentication required", code: "AUTH_REQUIRED" });
    return null;
  }

  const q = (req.query || {}) as Record<string, unknown>;
  const b = (req.body || {}) as Record<string, unknown>;
  const requested = String(q.schoolId || b.schoolId || "").trim();
  const match = evaluateStaffSchoolMatch(auth, requested || auth.authorizedSchoolId);
  if (!match.allowed) {
    res.status(match.status).json({
      success: false,
      error: match.error,
      code: match.status === 401 ? "AUTH_REQUIRED" : "SCHOOL_MISMATCH",
    });
    return null;
  }

  if (opts?.requireOwnerOrAdmin && !isSchoolOwnerOrAdminRole(auth.appRole)) {
    res.status(403).json({
      success: false,
      error: "Owner or Admin access required",
      code: "ROLE_DENIED",
    });
    return null;
  }

  return { auth, schoolId: auth.authorizedSchoolId };
}

router.get("/messages", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res);
    if (!gate) return;
    const schoolId = gate.schoolId;

    const status = String(req.query.status || "").trim() as CommunicationMessageStatus | "";
    const channel = String(req.query.channel || "").trim() as CommunicationChannel | "";
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where: Record<string, unknown> = { schoolId };
    if (status) where.status = status;
    if (channel) where.channel = channel;

    const [items, total] = await Promise.all([
      prisma.communicationMessage.findMany({
        where,
        orderBy: { queuedAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          parent: { select: { id: true, firstName: true, surname: true, email: true, cellNo: true } },
          learner: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.communicationMessage.count({ where }),
    ]);

    return res.json({ success: true, items, total, limit, offset, schoolId });
  } catch (e) {
    console.error("[communication-engine] list messages", e);
    return res.status(500).json({ success: false, error: "Failed to load messages" });
  }
});

router.get("/messages/stats", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res);
    if (!gate) return;
    const schoolId = gate.schoolId;

    const grouped = await prisma.communicationMessage.groupBy({
      by: ["status"],
      where: { schoolId },
      _count: { _all: true },
    });

    const byChannel = await prisma.communicationMessage.groupBy({
      by: ["channel"],
      where: { schoolId },
      _count: { _all: true },
    });

    const byCategory = await prisma.communicationMessage.groupBy({
      by: ["category"],
      where: { schoolId },
      _count: { _all: true },
    });

    return res.json({
      success: true,
      schoolId,
      byStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      byChannel: Object.fromEntries(byChannel.map((g) => [g.channel, g._count._all])),
      byCategory: Object.fromEntries(byCategory.map((g) => [g.category, g._count._all])),
    });
  } catch (e) {
    console.error("[communication-engine] stats", e);
    return res.status(500).json({ success: false, error: "Failed to load stats" });
  }
});

router.get("/campaigns", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res);
    if (!gate) return;
    const schoolId = gate.schoolId;
    const campaigns = await prisma.communicationCampaign.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        _count: { select: { messages: true } },
      },
    });
    return res.json({ success: true, campaigns, schoolId });
  } catch (e) {
    console.error("[communication-engine] campaigns", e);
    return res.status(500).json({ success: false, error: "Failed to load campaigns" });
  }
});

router.post("/messages/:id/retry", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res, { requireOwnerOrAdmin: true });
    if (!gate) return;
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "id required" });
    const r = await retryCommunicationMessage(prisma, { messageId: id, schoolId: gate.schoolId });
    if (!r.ok) {
      const status = r.error === "not_found" ? 404 : 400;
      return res.status(status).json({ success: false, error: r.error });
    }
    return res.json({ success: true, schoolId: gate.schoolId });
  } catch (e) {
    console.error("[communication-engine] retry", e);
    return res.status(500).json({ success: false, error: "Retry failed" });
  }
});

/** Dry-run: list candidates only — never claims or sends. Owner/Admin. */
router.get("/queue/preview", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res, { requireOwnerOrAdmin: true });
    if (!gate) return;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const preview = await previewCommunicationQueueBatch(prisma, {
      schoolId: gate.schoolId,
      limit,
    });
    return res.json({
      success: true,
      dryRun: true,
      sent: false,
      ...preview,
      note: "Preview only — no messages were claimed or sent.",
    });
  } catch (e) {
    console.error("[communication-engine] preview", e);
    return res.status(500).json({ success: false, error: "Preview failed" });
  }
});

/**
 * Process queue for the authenticated staff school only.
 * Optional body.dryRun=true previews without sending (same as GET /queue/preview).
 * Client schoolId is ignored for tenancy; JWT school wins.
 */
router.post("/queue/process", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res, { requireOwnerOrAdmin: true });
    if (!gate) return;

    const dryRun =
      req.body?.dryRun === true ||
      String(req.body?.dryRun || req.query.dryRun || "").toLowerCase() === "true";

    await ensureDefaultCommunicationTemplates(prisma);
    const result = await processCommunicationQueueBatch(prisma, {
      schoolId: gate.schoolId,
      limit: 40,
      dryRun,
    });
    return res.json({
      success: true,
      ...result,
      note: dryRun
        ? "Dry run — no providers called and no statuses changed."
        : "Processed for authorised school only. Simulated provider results are not marked sent.",
    });
  } catch (e) {
    console.error("[communication-engine] process", e);
    return res.status(500).json({ success: false, error: "Process failed" });
  }
});

router.get("/provider-settings", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res);
    if (!gate) return;
    const schoolId = gate.schoolId;
    const row = await prisma.schoolCommunicationProfile.findUnique({ where: { schoolId } });
    return res.json({
      success: true,
      settings: row || {
        schoolId,
        smtp: null,
        smsProvider: null,
        whatsappProvider: null,
        pushProvider: null,
        senderDisplayName: "",
        replyToEmail: "",
      },
    });
  } catch (e) {
    console.error("[communication-engine] get provider-settings", e);
    return res.status(500).json({ success: false, error: "Failed to load settings" });
  }
});

router.put("/provider-settings", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res, { requireOwnerOrAdmin: true });
    if (!gate) return;
    const schoolId = gate.schoolId;
    const smtp = req.body?.smtp;
    const smsProvider = req.body?.smsProvider;
    const whatsappProvider = req.body?.whatsappProvider;
    const pushProvider = req.body?.pushProvider;
    const senderDisplayName = String(req.body?.senderDisplayName ?? "");
    const replyToEmail = String(req.body?.replyToEmail ?? "");

    const row = await prisma.schoolCommunicationProfile.upsert({
      where: { schoolId },
      create: {
        schoolId,
        smtp: smtp ?? undefined,
        smsProvider: smsProvider ?? undefined,
        whatsappProvider: whatsappProvider ?? undefined,
        pushProvider: pushProvider ?? undefined,
        senderDisplayName,
        replyToEmail,
      },
      update: {
        ...(smtp !== undefined ? { smtp } : {}),
        ...(smsProvider !== undefined ? { smsProvider } : {}),
        ...(whatsappProvider !== undefined ? { whatsappProvider } : {}),
        ...(pushProvider !== undefined ? { pushProvider } : {}),
        senderDisplayName,
        replyToEmail,
      },
    });
    return res.json({ success: true, settings: row });
  } catch (e) {
    console.error("[communication-engine] put provider-settings", e);
    return res.status(500).json({ success: false, error: "Failed to save settings" });
  }
});

/**
 * Legacy unauthenticated body-based register — disabled (Phase 4A).
 */
router.post("/push/register", async (_req, res) => {
  return res.status(410).json({
    success: false,
    error: "Push registration moved to authenticated parent-portal endpoints",
    code: "PUSH_REGISTER_MOVED",
  });
});

router.get("/templates", async (req, res) => {
  try {
    const gate = await requireEngineSchoolAccess(req, res);
    if (!gate) return;
    const schoolId = gate.schoolId;
    await ensureDefaultCommunicationTemplates(prisma);
    const templates = await prisma.communicationTemplate.findMany({
      where: {
        OR: [{ schoolId: null }, { schoolId }],
      },
      orderBy: [{ schoolId: "asc" }, { templateKey: "asc" }],
    });
    return res.json({ success: true, templates, schoolId });
  } catch (e) {
    console.error("[communication-engine] templates", e);
    return res.status(500).json({ success: false, error: "Failed to load templates" });
  }
});

export default router;
