/**
 * Read-only school-scoped notification overview for Communications Centre.
 * Never returns private message bodies; no resend/send controls.
 */
import { Router } from "express";
import { prisma } from "../prisma";
import {
  allowSchool,
  resolveStaffSchoolGate,
  sendAuthRequired,
} from "../middleware/staffSchoolGate";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });

    const gate = await resolveStaffSchoolGate(req.headers.authorization);
    if (!gate) {
      sendAuthRequired(res);
      return;
    }
    if (!allowSchool(gate, schoolId, res)) return;

    const [
      inAppTotal,
      inAppUnread,
      inAppRead,
      byType,
      pushByStatus,
      pushExternalSent,
      pushMockOrSuppressed,
      recent,
    ] = await Promise.all([
      prisma.parentNotification.count({ where: { schoolId } }),
      prisma.parentNotification.count({ where: { schoolId, isRead: false } }),
      prisma.parentNotification.count({ where: { schoolId, isRead: true } }),
      prisma.parentNotification.groupBy({
        by: ["type"],
        where: { schoolId },
        _count: { _all: true },
      }),
      prisma.parentPushDelivery.groupBy({
        by: ["status"],
        where: { schoolId },
        _count: { _all: true },
      }),
      prisma.parentPushDelivery.count({
        where: { schoolId, externalSent: true },
      }),
      prisma.parentPushDelivery.count({
        where: {
          schoolId,
          status: { in: ["mock_ok", "suppressed"] },
        },
      }),
      prisma.parentNotification.findMany({
        where: { schoolId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          type: true,
          title: true,
          isRead: true,
          createdAt: true,
          // deliberately omit message body
        },
      }),
    ]);

    const pushStatus: Record<string, number> = {};
    for (const row of pushByStatus) {
      pushStatus[row.status] = row._count._all;
    }

    const queued =
      (pushStatus.queued || 0) + (pushStatus.sending || 0);
    const deferred = pushStatus.deferred || 0;
    const sent = pushStatus.sent || 0;
    const failed = (pushStatus.failed || 0) + (pushStatus.expired || 0);
    const mockOk = pushStatus.mock_ok || 0;
    const suppressed = pushStatus.suppressed || 0;
    const skipped = pushStatus.skipped || 0;

    return res.json({
      success: true,
      schoolId,
      inApp: {
        created: inAppTotal,
        unread: inAppUnread,
        read: inAppRead,
        byType: Object.fromEntries(byType.map((t) => [t.type, t._count._all])),
      },
      push: {
        byStatus: pushStatus,
        queued,
        deferred,
        sent,
        failed,
        mock_ok: mockOk,
        suppressed,
        skipped,
        /** Real external Web Push acknowledgements only. */
        externalSent: pushExternalSent,
        /** mock_ok + suppressed are NOT externally delivered. */
        notExternallyDelivered: pushMockOrSuppressed,
        note:
          "mock_ok and suppressed mean no external provider delivery. externalSent is the only real-sent count.",
      },
      recent: recent.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        isRead: r.isRead,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("school-notifications-overview", e);
    return res.status(500).json({ success: false, error: "Failed to load notification overview" });
  }
});

export default router;
