import { Router } from "express";
import type { ParentNotificationType } from "@prisma/client";
import { prisma } from "../prisma";
import {
  createParentNotification,
  debugParentThreadResolution,
  findParentByCredentials,
  getOrCreateThread,
  logParentThreadResolution,
  mapThreadMessage,
  notifyParentsForLearner,
  notifyParentsInvoiceRun,
  runMigrationParentOnboarding,
} from "../services/parentPortalService";
import { parentAuthMiddleware, signParentToken, verifyParentToken } from "../middleware/parentAuth";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  calculateBalanceFromEntries,
  collectFamilyAccountEntries,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import { sendStatementEmail } from "../services/statementEmailService";
import { buildSetupRequiredPayload } from "../services/schoolEmailService";
import { buildAndGenerateStatementPdf } from "../services/statementPdfData";
import { normalizeStatementPeriod } from "../utils/statementPeriod";
import {
  buildOtpStoreKey,
  consumeStoredOtp,
  deliverOtpSms,
  generateOtpCode,
  isSchoolSmsConfiguredForOtp,
  storeOtp,
  type OtpPurpose,
} from "../services/otpSmsService";

const router = Router();

async function parentWithLearners(parentId: string, schoolId: string) {
  return prisma.parent.findFirst({
    where: { id: parentId, schoolId },
    include: {
      links: {
        include: {
          learner: {
            include: {
              familyAccount: { select: { id: true, accountRef: true, familyName: true } },
            },
          },
        },
      },
      school: { select: { id: true, name: true } },
      onboarding: true,
    },
  });
}

type ParentPortalLearner = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
  admissionNo: string | null;
  familyAccountId: string | null;
  familyAccount: { id: string; accountRef: string; familyName?: string | null } | null;
};

function resolveParentFamilyBillingScope(
  learners: ParentPortalLearner[],
  anchorLearnerId: string
) {
  const anchor =
    learners.find((l) => l.id === anchorLearnerId) || (learners.length === 1 ? learners[0] : null);
  if (!anchor) {
    return { accountRef: "", learnerIds: [] as string[], learners: [] as ParentPortalLearner[] };
  }

  const familyId = String(anchor.familyAccountId || anchor.familyAccount?.id || "").trim();
  const accountRef = resolveLearnerAccountNo(anchor);

  let group: ParentPortalLearner[] = [anchor];
  if (familyId) {
    group = learners.filter(
      (l) => String(l.familyAccountId || l.familyAccount?.id || "") === familyId
    );
  } else if (accountRef) {
    group = learners.filter((l) => resolveLearnerAccountNo(l) === accountRef);
  }

  return {
    accountRef,
    learnerIds: group.map((l) => l.id),
    learners: group,
  };
}

function resolveEntryLearnerLabel(
  entry: { learnerId: string; type: string },
  nameByLearnerId: Map<string, string>,
  accountRef: string
): string {
  const learnerId = String(entry.learnerId || "").trim();
  const ref = String(accountRef || "").trim();
  if (learnerId && nameByLearnerId.has(learnerId)) {
    return nameByLearnerId.get(learnerId) || "";
  }
  if (entry.type === "payment" && (!learnerId || (ref && learnerId === ref))) {
    return "Family account";
  }
  return "";
}

function learnerMatchesNotice(
  learner: { id: string; grade: string; className: string | null },
  notice: { learnerId: string | null; grade: string | null; className: string | null }
) {
  if (notice.learnerId && notice.learnerId === learner.id) return true;
  if (notice.grade && notice.grade === learner.grade) return true;
  if (notice.className && notice.className === String(learner.className || "")) return true;
  if (!notice.learnerId && !notice.grade && !notice.className) return true;
  return false;
}

// ——— Auth (ID + OTP placeholder) ———

router.post("/auth/request-otp", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const idNumber = String(req.body?.idNumber || "").trim();
    const cellNo = String(req.body?.cellNo || "").trim();

    if (!schoolId || !idNumber) {
      return res.status(400).json({ success: false, error: "schoolId and idNumber are required" });
    }

    const parent = await findParentByCredentials({ schoolId, idNumber, cellNo });
    if (!parent) {
      return res.status(404).json({ success: false, error: "Parent not found for this school" });
    }

    const onboarding = await prisma.parentOnboarding.findUnique({
      where: { parentId: parent.id },
      select: { status: true },
    });
    const purpose: OtpPurpose =
      onboarding?.status === "REGISTERED" ? "parent_login" : "parent_registration";

    const code = generateOtpCode();
    const otpKey = buildOtpStoreKey(`parent:${schoolId}`, idNumber);
    storeOtp(otpKey, code, purpose);

    const smsCell = cellNo || parent.cellNo || "";
    const smsConfigured = await isSchoolSmsConfiguredForOtp(schoolId);
    const deliveryResult = await deliverOtpSms({
      schoolId,
      cellNo: smsCell,
      purpose,
      code,
      schoolName: parent.school?.name || undefined,
      clientMessageIdPrefix: `parent-${purpose}`,
    });

    const devMode = process.env.NODE_ENV !== "production";
    const includeDevOtp = devMode && (!smsConfigured || !deliveryResult.delivered);

    return res.json({
      success: true,
      message: deliveryResult.delivered
        ? "Verification code sent by SMS."
        : deliveryResult.delivery === "not_configured"
          ? "SMS provider not configured for this school."
          : deliveryResult.delivery === "missing_mobile"
            ? "No mobile number on file to send SMS."
            : "Could not send SMS. Try again or contact the school.",
      smsConfigured,
      delivery: deliveryResult.delivery,
      purpose,
      ...(includeDevOtp ? { devOtp: code, testOtp: code } : {}),
    });
  } catch (e) {
    console.error("request-otp", e);
    return res.status(500).json({ success: false, error: "Failed to request OTP" });
  }
});

router.post("/auth/verify-otp", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const idNumber = String(req.body?.idNumber || "").trim();
    const cellNo = String(req.body?.cellNo || "").trim();
    const code = String(req.body?.code || "").trim();

    if (!schoolId || !idNumber || !code) {
      return res.status(400).json({ success: false, error: "schoolId, idNumber and code are required" });
    }

    const parent = await findParentByCredentials({ schoolId, idNumber, cellNo });
    if (!parent) {
      return res.status(404).json({ success: false, error: "Parent not found" });
    }

    const otpKey = buildOtpStoreKey(`parent:${schoolId}`, idNumber);
    const devBypass = code === "000000" && process.env.NODE_ENV !== "production";
    if (!devBypass && !consumeStoredOtp(otpKey, code)) {
      return res.status(401).json({ success: false, error: "Invalid or expired OTP" });
    }

    await prisma.parentOnboarding.upsert({
      where: { parentId: parent.id },
      create: { schoolId, parentId: parent.id, status: "REGISTERED", registeredAt: new Date() },
      update: { status: "REGISTERED", registeredAt: new Date() },
    });

    const token = signParentToken({
      parentId: parent.id,
      schoolId: parent.schoolId,
      idNumber: parent.idNumber || idNumber,
    });

    return res.json({
      success: true,
      token,
      parent: {
        id: parent.id,
        firstName: parent.firstName,
        surname: parent.surname,
        cellNo: parent.cellNo,
        email: parent.email,
        school: parent.school,
      },
      learners: parent.links.map((link) => ({
        linkId: link.id,
        relation: link.relation,
        isPrimary: link.isPrimary,
        learner: link.learner,
      })),
    });
  } catch (e) {
    console.error("verify-otp", e);
    return res.status(500).json({ success: false, error: "Failed to verify OTP" });
  }
});

router.get("/me", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });

    await prisma.parentOnboarding.updateMany({
      where: { parentId: parent.id, status: "INVITED" },
      data: { status: "OPENED", openedAt: new Date() },
    });

    return res.json({
      success: true,
      parent: {
        id: parent.id,
        firstName: parent.firstName,
        surname: parent.surname,
        cellNo: parent.cellNo,
        email: parent.email,
        idNumber: parent.idNumber,
        school: parent.school,
        onboarding: parent.onboarding,
      },
      learners: parent.links.map((link) => ({
        linkId: link.id,
        relation: link.relation,
        isPrimary: link.isPrimary,
        learner: link.learner,
      })),
    });
  } catch (e) {
    console.error("parent me", e);
    return res.status(500).json({ success: false, error: "Failed to load profile" });
  }
});

router.get("/dashboard", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const learnerId = String(req.query.learnerId || "").trim();

    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });

    const learners = parent.links.map((l) => l.learner);
    const activeLearner =
      learners.find((l) => l.id === learnerId) || (learners.length === 1 ? learners[0] : null);

    const learnerIds = learners.map((l) => l.id);

    const [notifications, unreadMessages, incidents, homework, notices, documents] =
      await Promise.all([
        prisma.parentNotification.findMany({
          where: { parentId: auth.parentId, schoolId: auth.schoolId },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        prisma.parentTeacherMessage.count({
          where: {
            thread: { parentId: auth.parentId, schoolId: auth.schoolId },
            senderType: { in: ["TEACHER", "ADMIN"] },
            isRead: false,
          },
        }),
        activeLearner
          ? prisma.learnerIncident.findMany({
              where: {
                schoolId: auth.schoolId,
                learnerId: activeLearner.id,
                parentVisible: true,
              },
              orderBy: { incidentDate: "desc" },
              take: 10,
            })
          : Promise.resolve([]),
        activeLearner
          ? prisma.homeworkPost.findMany({
              where: {
                schoolId: auth.schoolId,
                OR: [
                  { learnerId: activeLearner.id },
                  { grade: activeLearner.grade, learnerId: null },
                  { className: activeLearner.className || "", learnerId: null },
                ],
              },
              orderBy: { createdAt: "desc" },
              take: 10,
            })
          : Promise.resolve([]),
        prisma.schoolNotice.findMany({
          where: { schoolId: auth.schoolId },
          orderBy: { publishedAt: "desc" },
          take: 50,
        }),
        prisma.parentDocument.findMany({
          where: { schoolId: auth.schoolId },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
      ]);

    const latestInvoice = notifications.find((n) => n.type === "INVOICE_READY") || null;
    const filteredNotices = activeLearner
      ? notices.filter((n) => learnerMatchesNotice(activeLearner, n))
      : notices.filter((n) =>
          learners.some((l) => learnerMatchesNotice(l, n))
        );
    const filteredDocs = activeLearner
      ? documents.filter(
          (d) =>
            (!d.learnerId && !d.grade && !d.className) ||
            d.learnerId === activeLearner.id ||
            d.grade === activeLearner.grade ||
            d.className === activeLearner.className
        )
      : documents;

    return res.json({
      success: true,
      learners,
      autoSelectLearner: learners.length === 1 ? learners[0] : null,
      activeLearner,
      latestInvoiceNotification: latestInvoice,
      unreadTeacherMessages: unreadMessages,
      notifications: notifications.slice(0, 15),
      incidents,
      homework,
      notices: filteredNotices.slice(0, 10),
      documents: filteredDocs.slice(0, 10),
    });
  } catch (e) {
    console.error("dashboard", e);
    return res.status(500).json({ success: false, error: "Failed to load dashboard" });
  }
});

router.get("/billing", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const learnerId = String(req.query.learnerId || "").trim();

    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });

    const learners = parent.links.map((l) => l.learner) as ParentPortalLearner[];
    const anchorId = learnerId || learners[0]?.id || "";
    const scope = resolveParentFamilyBillingScope(learners, anchorId);
    const ledger = readSchoolLedger(auth.schoolId);
    const entries = collectFamilyAccountEntries(ledger, {
      accountRef: scope.accountRef,
      learnerIds: scope.learnerIds,
    });
    const balance = calculateBalanceFromEntries(entries);
    const nameByLearnerId = new Map(
      scope.learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()])
    );

    const sorted = [...entries].sort(
      (a, b) =>
        new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
    );
    let running = 0;
    const transactions = sorted.map((entry, index) => {
      const amount = Number(entry.amount) || 0;
      const isDebit = entry.type === "invoice" || entry.type === "penalty";
      running += isDebit ? amount : -amount;
      const typeLabel =
        entry.type === "invoice"
          ? "Invoice"
          : entry.type === "penalty"
            ? "Penalty"
            : entry.type === "credit"
              ? "Credit"
              : "Payment";
      return {
        auditNo: index + 1,
        id: entry.id,
        date: entry.date || "",
        type: typeLabel,
        learner: resolveEntryLearnerLabel(entry, nameByLearnerId, scope.accountRef),
        reference: entry.reference || "",
        description: entry.description || "",
        amountIn: isDebit ? amount : 0,
        amountOut: !isDebit ? amount : 0,
        balance: running,
      };
    });

    const familyAccountId = String(
      scope.learners[0]?.familyAccountId || scope.learners[0]?.familyAccount?.id || ""
    ).trim();

    return res.json({
      success: true,
      balance,
      accountRef: scope.accountRef,
      familyAccountId: familyAccountId || null,
      isFamilyAccount: scope.learners.length > 1,
      learners: scope.learners.map((l) => ({
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        grade: l.grade,
      })),
      transactions: transactions.reverse(),
    });
  } catch (e) {
    console.error("parent billing", e);
    return res.status(500).json({ success: false, error: "Failed to load billing" });
  }
});

async function serveParentStatementPdf(
  req: import("express").Request,
  res: import("express").Response
) {
  const auth = (req as { parentAuth?: { parentId: string; schoolId: string } }).parentAuth;
  if (!auth?.parentId || !auth?.schoolId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const learnerId = String(req.query?.learnerId || "").trim();
  if (!learnerId) {
    return res.status(400).json({ success: false, error: "Missing learnerId" });
  }

  const parent = await parentWithLearners(auth.parentId, auth.schoolId);
  if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });

  const learners = parent.links.map((l) => l.learner) as ParentPortalLearner[];
  const scope = resolveParentFamilyBillingScope(learners, learnerId);
  if (!scope.learnerIds.length) {
    return res.status(403).json({ success: false, error: "Learner not linked to this account" });
  }

  console.log("[PDF] generating", learnerId, { schoolId: auth.schoolId, parentId: auth.parentId });

  const period = normalizeStatementPeriod(
    typeof req.query?.period === "string" ? String(req.query.period).trim() : undefined
  );

  const { buffer, filename } = await buildAndGenerateStatementPdf({
    schoolId: auth.schoolId,
    learnerId,
    period,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(buffer.length));
  return res.send(buffer);
}

// GET /api/parent-portal/billing/statement.pdf | statement-pdf
router.get("/billing/statement.pdf", parentAuthMiddleware, async (req, res) => {
  try {
    return await serveParentStatementPdf(req, res);
  } catch (error: unknown) {
    console.error("[parent-portal] GET billing/statement.pdf failed:", error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to generate statement PDF",
    });
  }
});

router.get("/billing/statement-pdf", parentAuthMiddleware, async (req, res) => {
  try {
    return await serveParentStatementPdf(req, res);
  } catch (error: unknown) {
    console.error("[parent-portal] GET billing/statement-pdf failed:", error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to generate statement PDF",
    });
  }
});

router.post("/billing/email-statement", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as { parentAuth?: { parentId: string; schoolId: string } }).parentAuth;
    if (!auth?.parentId || !auth?.schoolId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const learnerId = String(req.body?.learnerId || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const html = String(req.body?.html || "").trim();

    if (!learnerId || !subject || !html) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: learnerId, subject, html",
      });
    }

    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });

    const learners = parent.links.map((l) => l.learner) as ParentPortalLearner[];
    const scope = resolveParentFamilyBillingScope(learners, learnerId);
    if (!scope.learnerIds.length) {
      return res.status(403).json({ success: false, error: "Learner not linked to this account" });
    }

    const to = String(parent.email || "").trim();
    if (!to) {
      return res.status(400).json({
        success: false,
        error: "No email address on your profile. Contact the school to update your details.",
      });
    }

    const result = await sendStatementEmail({
      schoolId: auth.schoolId,
      to,
      subject,
      html,
      learnerId,
      period: normalizeStatementPeriod(
        typeof req.body?.period === "string" ? String(req.body.period).trim() : undefined
      ),
    });

    return res.json({ success: true, messageId: result.messageId });
  } catch (error: unknown) {
    console.error("parent billing email-statement", error);
    const err = error as Error & { setupRequired?: boolean };
    if (err.setupRequired) {
      return res.status(409).json(buildSetupRequiredPayload());
    }
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to email statement",
    });
  }
});

router.get("/notifications", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const items = await prisma.parentNotification.findMany({
      where: { parentId: auth.parentId, schoolId: auth.schoolId },
      include: {
        learner: { select: { id: true, firstName: true, lastName: true, grade: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return res.json({ success: true, notifications: items });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load notifications" });
  }
});

router.patch("/notifications/:id/read", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const id = String(req.params.id);
    const item = await prisma.parentNotification.updateMany({
      where: { id, parentId: auth.parentId, schoolId: auth.schoolId },
      data: { isRead: true, readAt: new Date() },
    });
    return res.json({ success: true, updated: item.count });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to mark read" });
  }
});

router.patch("/notifications/read-all", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    await prisma.parentNotification.updateMany({
      where: { parentId: auth.parentId, schoolId: auth.schoolId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to mark all read" });
  }
});

// ——— Messaging ———

async function loadThreadForParent(opts: {
  schoolId: string;
  parentId: string;
  learnerId: string;
  markTeacherRead?: boolean;
}) {
  const link = await prisma.parentLearnerLink.findFirst({
    where: { parentId: opts.parentId, learnerId: opts.learnerId, schoolId: opts.schoolId },
  });
  if (!link) return { error: "Learner not linked to this parent", status: 403 as const };

  const { thread, classroom, learner } = await getOrCreateThread({
    schoolId: opts.schoolId,
    parentId: opts.parentId,
    learnerId: opts.learnerId,
  });

  if (opts.markTeacherRead) {
    await prisma.parentTeacherMessage.updateMany({
      where: {
        threadId: thread.id,
        senderType: { in: ["TEACHER", "ADMIN"] },
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });
  }

  return {
    classroomName: classroom?.name || learner.className || "",
    teacher: { name: thread.teacherName, email: thread.teacherEmail },
    thread: {
      id: thread.id,
      status: thread.status,
      messages: thread.messages.map(mapThreadMessage),
    },
  };
}

/** Legacy staff/kiosk lookup by cell + ID (no JWT). */
router.get("/thread", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const learnerId = String(req.query.learnerId || "").trim();

    if (bearer) {
      const auth = verifyParentToken(bearer);
      if (!auth) return res.status(401).json({ success: false, error: "Invalid session" });
      if (!learnerId) return res.status(400).json({ success: false, error: "learnerId required" });
      const data = await loadThreadForParent({
        schoolId: auth.schoolId,
        parentId: auth.parentId,
        learnerId,
        markTeacherRead: true,
      });
      if ("error" in data) return res.status(data.status ?? 403).json({ success: false, error: data.error });
      return res.json({ success: true, ...data });
    }

    const schoolId = String(req.query.schoolId || "").trim();
    const cellNo = String(req.query.cellNo || "").trim();
    const idNumber = String(req.query.idNumber || "").trim();
    if (!schoolId || !cellNo || !idNumber || !learnerId) {
      return res.status(400).json({
        success: false,
        error: "schoolId, cellNo, idNumber and learnerId are required",
      });
    }

    const parent = await findParentByCredentials({ schoolId, cellNo, idNumber });
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });

    const data = await loadThreadForParent({
      schoolId,
      parentId: parent.id,
      learnerId,
      markTeacherRead: true,
    });
    if ("error" in data) return res.status(data.status ?? 403).json({ success: false, error: data.error });
    return res.json({ success: true, ...data });
  } catch (e) {
    console.error("thread", e);
    return res.status(500).json({ success: false, error: "Failed to load thread" });
  }
});

async function sendParentMessage(opts: {
  schoolId: string;
  parentId: string;
  learnerId: string;
  body: string;
  attachments?: unknown;
}) {
  const parent = await prisma.parent.findFirst({
    where: { id: opts.parentId, schoolId: opts.schoolId },
  });
  if (!parent) return { error: "Parent not found", status: 404 as const };

  const link = await prisma.parentLearnerLink.findFirst({
    where: { parentId: opts.parentId, learnerId: opts.learnerId, schoolId: opts.schoolId },
  });
  if (!link) return { error: "Learner not linked to this parent", status: 403 as const };

  const { thread, classroom, learner } = await getOrCreateThread({
    schoolId: opts.schoolId,
    parentId: opts.parentId,
    learnerId: opts.learnerId,
  });

  const debug = await debugParentThreadResolution({
    schoolId: opts.schoolId,
    learnerId: opts.learnerId,
    parentId: opts.parentId,
  });
  if (debug) {
    logParentThreadResolution("parent-send-message", debug);
  } else {
    console.log("[parent-thread] parent-send-message", {
      learnerId: opts.learnerId,
      learnerClassName: learner.className,
      matchedClassroomId: classroom?.id,
      matchedClassroomName: classroom?.name,
      classroomTeacherEmail: classroom?.teacherEmail,
      threadTeacherEmail: thread.teacherEmail,
    });
  }

  const msg = await prisma.parentTeacherMessage.create({
    data: {
      threadId: thread.id,
      schoolId: opts.schoolId,
      senderType: "PARENT",
      senderName: `${parent.firstName} ${parent.surname}`.trim(),
      body: opts.body,
      attachments: opts.attachments || undefined,
    },
  });

  await prisma.parentTeacherThread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  return { message: mapThreadMessage(msg), threadId: thread.id };
}

router.post("/send-message", async (req, res) => {
  try {
    const learnerId = String(req.body?.learnerId || "").trim();
    const body = String(req.body?.body || req.body?.message || "").trim();
    const attachments = req.body?.attachments || null;

    if (!learnerId || !body) {
      return res.status(400).json({ success: false, error: "learnerId and body are required" });
    }

    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    let schoolId = String(req.body?.schoolId || "").trim();
    let parentId = "";

    if (bearer) {
      const auth = verifyParentToken(bearer);
      if (!auth) return res.status(401).json({ success: false, error: "Invalid session" });
      schoolId = auth.schoolId;
      parentId = auth.parentId;
    } else {
      const cellNo = String(req.body?.cellNo || "").trim();
      const idNumber = String(req.body?.idNumber || "").trim();
      if (!schoolId || !cellNo || !idNumber) {
        return res.status(400).json({
          success: false,
          error: "schoolId, cellNo and idNumber are required",
        });
      }
      const parent = await findParentByCredentials({ schoolId, cellNo, idNumber });
      if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
      parentId = parent.id;
    }

    const result = await sendParentMessage({
      schoolId,
      parentId,
      learnerId,
      body,
      attachments,
    });
    if ("error" in result) {
      const code = "status" in result && typeof result.status === "number" ? result.status : 400;
      return res.status(code).json({ success: false, error: result.error });
    }

    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("send-message", e);
    return res.status(500).json({ success: false, error: "Failed to send message" });
  }
});

// ——— Incidents ———

router.get("/incidents/:id", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const incident = await prisma.learnerIncident.findFirst({
      where: {
        id: String(req.params.id),
        schoolId: auth.schoolId,
        parentVisible: true,
      },
      include: { learner: true },
    });
    if (!incident) return res.status(404).json({ success: false, error: "Incident not found" });

    const link = await prisma.parentLearnerLink.findFirst({
      where: { parentId: auth.parentId, learnerId: incident.learnerId },
    });
    if (!link) return res.status(403).json({ success: false, error: "Access denied" });

    return res.json({
      success: true,
      incident: {
        id: incident.id,
        type: incident.type,
        subject: incident.subject,
        summary: incident.summary,
        incidentDate: incident.incidentDate,
        learner: incident.learner,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load incident" });
  }
});

// ——— Staff: create content + invoice notifications ———

router.post("/staff/incidents", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const learnerId = String(req.body?.learnerId || "").trim();
    const summary = String(req.body?.summary || req.body?.incident || "").trim();
    if (!schoolId || !learnerId || !summary) {
      return res.status(400).json({ success: false, error: "schoolId, learnerId and summary required" });
    }

    const incident = await prisma.learnerIncident.create({
      data: {
        schoolId,
        learnerId,
        type: String(req.body?.type || "General"),
        subject: String(req.body?.subject || "General"),
        summary,
        parentVisible: !Boolean(req.body?.private),
        internalNotes: req.body?.private ? String(req.body?.internalNotes || summary) : null,
        incidentDate: req.body?.date ? new Date(req.body.date) : new Date(),
        createdBy: String(req.body?.createdBy || ""),
      },
    });

    if (incident.parentVisible) {
      await notifyParentsForLearner({
        schoolId,
        learnerId,
        type: "INCIDENT",
        title: "Incident recorded",
        message: `An incident was recorded for your child: ${incident.subject}`,
        metadata: { incidentId: incident.id },
      });
    }

    return res.json({ success: true, incident });
  } catch (e) {
    console.error("create incident", e);
    return res.status(500).json({ success: false, error: "Failed to save incident" });
  }
});

router.get("/staff/incidents", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const incidents = await prisma.learnerIncident.findMany({
      where: { schoolId },
      include: { learner: { select: { id: true, firstName: true, lastName: true, grade: true, className: true } } },
      orderBy: { incidentDate: "desc" },
    });
    return res.json({ success: true, incidents });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load incidents" });
  }
});

router.post("/staff/homework", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const title = String(req.body?.title || "").trim();
    if (!schoolId || !title) {
      return res.status(400).json({ success: false, error: "schoolId and title required" });
    }

    const post = await prisma.homeworkPost.create({
      data: {
        schoolId,
        learnerId: req.body?.learnerId || null,
        grade: req.body?.grade || null,
        className: req.body?.className || null,
        title,
        description: req.body?.description || null,
        dueDate: req.body?.dueDate ? new Date(req.body.dueDate) : null,
        attachments: req.body?.attachments || undefined,
        createdBy: String(req.body?.createdBy || ""),
      },
    });

    if (post.learnerId) {
      await notifyParentsForLearner({
        schoolId,
        learnerId: post.learnerId,
        type: "HOMEWORK",
        title: "Homework uploaded",
        message: title,
        metadata: { homeworkId: post.id },
      });
    } else {
      const links = await prisma.parentLearnerLink.findMany({
        where: {
          schoolId,
          learner: {
            ...(post.grade ? { grade: post.grade } : {}),
            ...(post.className ? { className: post.className } : {}),
          },
        },
        select: { parentId: true, learnerId: true },
      });
      for (const link of links) {
        await createParentNotification({
          schoolId,
          parentId: link.parentId,
          learnerId: link.learnerId,
          type: "HOMEWORK",
          title: "Homework uploaded",
          message: title,
          metadata: { homeworkId: post.id },
        });
      }
    }

    return res.json({ success: true, post });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to create homework" });
  }
});

router.post("/staff/notices", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const title = String(req.body?.title || "").trim();
    const noticeType = String(req.body?.noticeType || "SCHOOL").toUpperCase();
    if (!schoolId || !title) {
      return res.status(400).json({ success: false, error: "schoolId and title required" });
    }

    const notice = await prisma.schoolNotice.create({
      data: {
        schoolId,
        noticeType: noticeType as any,
        title,
        body: String(req.body?.body || ""),
        grade: req.body?.grade || null,
        className: req.body?.className || null,
        learnerId: req.body?.learnerId || null,
        attachments: req.body?.attachments || undefined,
        createdBy: String(req.body?.createdBy || ""),
      },
    });

    const notifType: ParentNotificationType =
      noticeType === "ASSESSMENT"
        ? "ASSESSMENT"
        : noticeType === "EXAM"
          ? "EXAM"
          : "SCHOOL_NOTICE";

    const links = await prisma.parentLearnerLink.findMany({
      where: { schoolId },
      include: { learner: true },
    });

    for (const link of links) {
      if (!learnerMatchesNotice(link.learner, notice)) continue;
      await createParentNotification({
        schoolId,
        parentId: link.parentId,
        learnerId: link.learnerId,
        type: notifType,
        title,
        message: String(req.body?.body || title).slice(0, 500),
        metadata: { noticeId: notice.id },
      });
    }

    return res.json({ success: true, notice });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to create notice" });
  }
});

router.post("/staff/documents", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const title = String(req.body?.title || "").trim();
    const fileUrl = String(req.body?.fileUrl || "").trim();
    if (!schoolId || !title || !fileUrl) {
      return res.status(400).json({ success: false, error: "schoolId, title and fileUrl required" });
    }

    const doc = await prisma.parentDocument.create({
      data: {
        schoolId,
        title,
        description: req.body?.description || null,
        grade: req.body?.grade || null,
        className: req.body?.className || null,
        learnerId: req.body?.learnerId || null,
        fileUrl,
        fileName: String(req.body?.fileName || ""),
      },
    });

    const links = await prisma.parentLearnerLink.findMany({
      where: { schoolId },
      include: { learner: true },
    });
    for (const link of links) {
      if (!learnerMatchesNotice(link.learner, {
        learnerId: doc.learnerId,
        grade: doc.grade,
        className: doc.className,
      }))
        continue;
      await createParentNotification({
        schoolId,
        parentId: link.parentId,
        learnerId: link.learnerId,
        type: "DOCUMENT",
        title: "New document",
        message: title,
        metadata: { documentId: doc.id, fileUrl },
      });
    }

    return res.json({ success: true, document: doc });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to upload document" });
  }
});

router.post("/notify-invoice-run", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const month = String(req.body?.month || "").trim();
    const runId = String(req.body?.runId || "").trim();
    const learnerIds = Array.isArray(req.body?.learnerIds)
      ? req.body.learnerIds.map(String)
      : undefined;

    if (!schoolId || !runId) {
      return res.status(400).json({ success: false, error: "schoolId and runId required" });
    }

    const count = await notifyParentsInvoiceRun({ schoolId, month, runId, learnerIds });
    return res.json({ success: true, parentsNotified: count });
  } catch (e) {
    console.error("notify-invoice-run", e);
    return res.status(500).json({ success: false, error: "Failed to notify parents" });
  }
});

router.post("/migration/onboarding", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const result = await runMigrationParentOnboarding(schoolId);
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("migration onboarding", e);
    return res.status(500).json({ success: false, error: "Failed to run parent onboarding" });
  }
});

// Legacy lookup (cell + optional id) for staff-embedded portal
router.get("/lookup-by-cell", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const rawCellNo = String(req.query.cellNo || "").trim();
    const idNumber = String(req.query.idNumber || "").trim();
    if (!schoolId || !rawCellNo) {
      return res.status(400).json({ success: false, error: "schoolId and cellNo are required" });
    }
    const parent = await findParentByCredentials({ schoolId, cellNo: rawCellNo, idNumber });
    if (!parent) {
      return res.status(404).json({ success: false, error: "Parent not found" });
    }
    return res.json({
      success: true,
      parent: {
        id: parent.id,
        firstName: parent.firstName,
        surname: parent.surname,
        cellNo: parent.cellNo,
        email: parent.email,
        school: parent.school,
      },
      learners: parent.links.map((link) => ({
        linkId: link.id,
        isPrimary: link.isPrimary,
        relation: link.relation,
        learner: link.learner,
      })),
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Lookup failed" });
  }
});

export default router;
