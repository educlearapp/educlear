import { Router } from "express";
import path from "path";
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
  uniqueParentLearnerLinks,
} from "../services/parentPortalService";
import {
  parentPublishedHomeworkOrNoticeWhere,
  parentPublishedIncidentWhere,
} from "../utils/teacherVisibility";
import { parentHomeworkVisibilityWhere } from "../utils/parentHomeworkVisibility";
import { buildParentDocumentVisibilityWhere } from "../services/parentDocumentVisibility";
import {
  publicParentDocumentDto,
  resolveTeacherAppAbsolutePath,
  basenameFromTeacherAppFileUrl,
  internalTeacherAppFileUrl,
  SECURE_DOWNLOAD_HEADERS,
} from "../services/teacherAppFileAccess";
import {
  attachmentAtIndex,
  basenameFromPrefixedUrl,
  resolveUnderUploadDir,
  redactAttachmentUrls,
} from "../services/secureUploadAccess";
import { parentAuthMiddleware, signParentToken, verifyParentToken } from "../middleware/parentAuth";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import { resolveAuthoritativeAccountBalance } from "../services/statementAccounts";
import {
  collectFamilyAccountEntries,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import {
  EDUCLEAR_CREDIT_NOTE_TYPE,
  isEduClearCreditNoteEntry,
  shouldShowLedgerEntryOnStatement,
} from "../utils/billingDisplayRules";
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
import {
  assertSchoolModuleEntitled,
  MODULE_NOT_ENTITLED,
} from "../middleware/requireSchoolModule";
import { lookupParentPortalBySchool } from "../services/parentPortalLookup";
import { loadSchoolClassMembership, type SchoolClassMembership } from "../utils/classroomMembership";
import { rateLimitParentPortalLookup } from "../middleware/parentPortalLookupRateLimit";
import { rateLimitParentPushSubscribe } from "../middleware/parentPushSubscribeRateLimit";
import {
  allowSchool,
  resolveStaffSchoolGate,
  sendAuthRequired,
} from "../middleware/staffSchoolGate";
import {
  assertVapidConfiguredForSubscribe,
  disableParentSubscription,
  getOrDefaultPreferences,
  listParentSubscriptions,
  upsertParentSubscription,
  upsertPreferences,
  type ParentNotificationPreferenceInput,
} from "../services/parentPushFoundation";
import {
  listParentVisibleNotices,
  parentVisibleNoticeWhere,
} from "../services/schoolAnnouncementService";
import { parentMayViewNotice } from "../services/schoolAnnouncementAudience";
import { listParentVisibleEvents } from "../services/schoolEventService";
import { assignedClassroomIdsForTeacher } from "../utils/classroomTeachers";
import { normalizeStaffEmail } from "../utils/staffJwt";

async function requireSameSchoolStaff(
  req: { headers: { authorization?: string } },
  res: Parameters<typeof sendAuthRequired>[0],
  schoolId: string
): Promise<boolean> {
  const gate = await resolveStaffSchoolGate(req.headers.authorization);
  if (!gate) {
    sendAuthRequired(res);
    return false;
  }
  return allowSchool(gate, schoolId, res);
}

/** School-wide parent announcement publish roles (Owner/Admin/SCHOOL_ADMIN or super-admin). */
export function isSchoolWideNoticePublisherRole(opts: {
  superAdmin?: boolean;
  appRole?: string | null;
  role?: string | null;
}): boolean {
  if (opts.superAdmin) return true;
  const appRole = String(opts.appRole || "").trim();
  const jwtRole = String(opts.role || "").trim();
  return appRole === "Owner" || appRole === "Admin" || jwtRole === "SCHOOL_ADMIN";
}

async function requireSchoolWideNoticePublisher(
  req: { headers: { authorization?: string } },
  res: Parameters<typeof sendAuthRequired>[0],
  schoolId: string
): Promise<boolean> {
  const gate = await resolveStaffSchoolGate(req.headers.authorization);
  if (!gate) {
    sendAuthRequired(res);
    return false;
  }
  if (!allowSchool(gate, schoolId, res)) return false;
  if (
    isSchoolWideNoticePublisherRole({
      superAdmin: gate.superAdmin,
      appRole: gate.auth.appRole,
      role: gate.auth.role,
    })
  ) {
    return true;
  }
  res.status(403).json({
    success: false,
    error: "School admin access required to publish school-wide notices",
    code: "FORBIDDEN",
  });
  return false;
}

const router = Router();

/** Parent Portal is a CORE product surface (learners / billing / school communications). */
router.use(async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    let schoolId = String(body.schoolId || query.schoolId || "").trim();
    if (!schoolId) {
      const authHeader = String(req.headers.authorization || "");
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token) {
        const payload = verifyParentToken(token);
        if (payload?.schoolId) schoolId = payload.schoolId;
      }
    }
    if (!schoolId) {
      // Routes that resolve school later (e.g. lookup-by-cell) still proceed;
      // authenticated parent paths always carry schoolId in the JWT.
      return next();
    }
    const decision = await assertSchoolModuleEntitled(schoolId, "CORE");
    if (!decision.allowed) {
      return res.status(decision.status).json({
        success: false,
        error: decision.error,
        code: decision.code || MODULE_NOT_ENTITLED,
        module: "CORE",
      });
    }
    return next();
  } catch (error) {
    console.error("[parent-portal] CORE gate failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

/**
 * Load parent + linked learners for Parent Portal JWT school scope.
 * Filters ParentLearnerLink by BOTH link.schoolId and learner.schoolId so a forged
 * link.schoolId cannot expose another school's learner via /me, /dashboard, /billing,
 * statement PDF, or statement email.
 * Exported for focused local security regression tests only.
 */
export async function parentWithLearners(parentId: string, schoolId: string) {
  const sid = String(schoolId || "").trim();
  if (!sid || !parentId) return null;

  const parent = await prisma.parent.findFirst({
    where: { id: parentId, schoolId: sid },
    include: {
      links: {
        where: {
          schoolId: sid,
          learner: { schoolId: sid },
        },
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

  if (!parent) return null;

  // Defence in depth if relation filters ever diverge from include payload.
  parent.links = parent.links.filter(
    (link) =>
      String(link.schoolId || "") === sid &&
      !!link.learner &&
      String(link.learner.schoolId || "") === sid
  );

  return parent;
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
  membership: SchoolClassMembership,
  learner: { id: string; grade: string; className: string | null },
  notice: {
    learnerId: string | null;
    grade: string | null;
    className: string | null;
    audienceParentIds?: unknown;
  },
  parentId?: string
) {
  // Prefer parent-aware visibility when parentId is known (individual audience must not leak school-wide).
  if (parentId) {
    return parentMayViewNotice({
      parentId,
      learners: [learner],
      notice,
      sameClassroom: (a, b) => membership.resolver.sameClassroom(a, b),
    });
  }
  if (notice.audienceParentIds != null) {
    // Without parentId, never treat explicit parent-audience notices as class/school matches.
    return false;
  }
  if (notice.learnerId && notice.learnerId === learner.id) return true;
  if (notice.grade && notice.grade === learner.grade) return true;
  if (notice.className && membership.resolver.sameClassroom(notice.className, learner.className)) return true;
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
    const membership = await loadSchoolClassMembership(auth.schoolId);

    const eventTargets = (activeLearner ? [activeLearner] : learners).map((l) => ({
      id: l.id,
      grade: String(l.grade || ""),
      className: l.className ?? null,
      firstName: l.firstName,
      lastName: l.lastName,
    }));

    const [notifications, unreadMessages, incidents, homework, notices, documents, upcomingEventsPage] =
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
                ...parentPublishedIncidentWhere(),
              },
              orderBy: { incidentDate: "desc" },
              take: 10,
            })
          : Promise.resolve([]),
        prisma.homeworkPost.findMany({
          where: parentHomeworkVisibilityWhere(
            auth.schoolId,
            activeLearner ? [activeLearner] : learners,
            membership
          ),
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.schoolNotice.findMany({
          where: {
            schoolId: auth.schoolId,
            ...parentVisibleNoticeWhere(),
          },
          orderBy: { publishedAt: "desc" },
          take: 50,
        }),
        prisma.parentDocument.findMany({
          where: buildParentDocumentVisibilityWhere({
            schoolId: auth.schoolId,
            learners,
            activeLearnerId: activeLearner?.id || null,
            spellingsFor: (cn) => membership.spellingsFor(cn),
          }),
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        listParentVisibleEvents({
          schoolId: auth.schoolId,
          learners: eventTargets,
          spellingsFor: (cn) => membership.spellingsFor(cn),
          limit: 8,
          range: "upcoming",
        }),
      ]);

    const latestInvoice = notifications.find((n) => n.type === "INVOICE_READY") || null;
    const filteredNotices = activeLearner
      ? notices.filter((n) => learnerMatchesNotice(membership, activeLearner, n, auth.parentId))
      : notices.filter((n) =>
          learners.some((l) => learnerMatchesNotice(membership, l, n, auth.parentId))
        );
    const filteredDocs = documents;

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
      documents: filteredDocs.slice(0, 10).map((d) => publicParentDocumentDto(d, { audience: "parent" })),
      upcomingEvents: upcomingEventsPage.events,
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
    }).filter((entry) => shouldShowLedgerEntryOnStatement(entry, false));
    const balance = await resolveAuthoritativeAccountBalance(auth.schoolId, scope.accountRef, {
      ledger,
    });
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
              ? isEduClearCreditNoteEntry(entry)
                ? EDUCLEAR_CREDIT_NOTE_TYPE
                : "Credit"
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
        ...(Array.isArray(entry.chargeLines) && entry.chargeLines.length
          ? {
              chargeLines: entry.chargeLines.map((line) => ({
                lineKey: String(line.lineKey || "").trim(),
                description: String(line.description || "").trim(),
                amount: Number(line.amount) || 0,
              })),
            }
          : {}),
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

// ——— Push subscriptions + notification preferences (Phase 4A foundation; no live send) ———

router.get("/push/vapid-public-key", parentAuthMiddleware, async (_req, res) => {
  const publicKey = assertVapidConfiguredForSubscribe();
  return res.json({
    success: true,
    publicKey,
    configured: Boolean(publicKey),
    deliveryEnabled: false,
    note: "Web Push delivery is deferred to Phase 4B. Public key only — never expose private VAPID.",
  });
});

router.get("/push/subscriptions", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const subscriptions = await listParentSubscriptions(auth.schoolId, auth.parentId);
    return res.json({ success: true, subscriptions, deliveryEnabled: false });
  } catch (e) {
    console.error("[parent-portal] list push subscriptions", e);
    return res.status(500).json({ success: false, error: "Failed to list subscriptions" });
  }
});

router.post("/push/subscriptions", parentAuthMiddleware, rateLimitParentPushSubscribe, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    // schoolId / parentId come only from verified JWT — ignore any body spoofing.
    const subscription = await upsertParentSubscription({
      schoolId: auth.schoolId,
      parentId: auth.parentId,
      endpoint: String(req.body?.endpoint || ""),
      keys: req.body?.keys || null,
      userAgent: String(req.headers["user-agent"] || req.body?.userAgent || "").slice(0, 400) || null,
      deviceLabel: req.body?.deviceLabel != null ? String(req.body.deviceLabel) : null,
    });
    console.info("[parent-portal] push subscription upsert", {
      schoolId: auth.schoolId,
      parentId: auth.parentId,
      subscriptionId: subscription.id,
      endpointHost: subscription.endpointHost,
    });
    return res.json({
      success: true,
      subscription,
      deliveryEnabled: false,
      note: "Subscription stored. Live Web Push send is not enabled in Phase 4A.",
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    if (status >= 500) console.error("[parent-portal] push subscribe", e);
    return res.status(status).json({
      success: false,
      error: status >= 500 ? "Subscription failed" : String(e?.message || "Subscription failed"),
    });
  }
});

router.delete(
  "/push/subscriptions/:id",
  parentAuthMiddleware,
  rateLimitParentPushSubscribe,
  async (req, res) => {
    try {
      const auth = (req as any).parentAuth;
      const result = await disableParentSubscription({
        schoolId: auth.schoolId,
        parentId: auth.parentId,
        subscriptionId: String(req.params.id || ""),
      });
      return res.json({ success: true, ...result });
    } catch (e: any) {
      const status = Number(e?.status) || 500;
      if (status >= 500) console.error("[parent-portal] push unsubscribe", e);
      return res.status(status).json({
        success: false,
        error: status >= 500 ? "Unsubscribe failed" : String(e?.message || "Unsubscribe failed"),
      });
    }
  }
);

router.post("/push/unsubscribe", parentAuthMiddleware, rateLimitParentPushSubscribe, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const result = await disableParentSubscription({
      schoolId: auth.schoolId,
      parentId: auth.parentId,
      endpoint: req.body?.endpoint ? String(req.body.endpoint) : undefined,
      subscriptionId: req.body?.subscriptionId ? String(req.body.subscriptionId) : undefined,
    });
    return res.json({ success: true, ...result });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    if (status >= 500) console.error("[parent-portal] push unsubscribe by endpoint", e);
    return res.status(status).json({
      success: false,
      error: status >= 500 ? "Unsubscribe failed" : String(e?.message || "Unsubscribe failed"),
    });
  }
});

router.get("/notification-preferences", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const preferences = await getOrDefaultPreferences(auth.schoolId, auth.parentId);
    return res.json({ success: true, preferences });
  } catch (e) {
    console.error("[parent-portal] get notification preferences", e);
    return res.status(500).json({ success: false, error: "Failed to load preferences" });
  }
});

router.put("/notification-preferences", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const body = (req.body || {}) as ParentNotificationPreferenceInput;
    const input: ParentNotificationPreferenceInput = {};
    if (typeof body.pushEnabled === "boolean") input.pushEnabled = body.pushEnabled;
    if (typeof body.pushTeacherMessages === "boolean") input.pushTeacherMessages = body.pushTeacherMessages;
    if (typeof body.pushAnnouncements === "boolean") input.pushAnnouncements = body.pushAnnouncements;
    if (typeof body.pushEvents === "boolean") input.pushEvents = body.pushEvents;
    if (typeof body.soundEnabled === "boolean") input.soundEnabled = body.soundEnabled;
    if (typeof body.lockScreenPreview === "boolean") input.lockScreenPreview = body.lockScreenPreview;
    if (body.quietHoursStart !== undefined) {
      input.quietHoursStart = body.quietHoursStart == null ? null : String(body.quietHoursStart);
    }
    if (body.quietHoursEnd !== undefined) {
      input.quietHoursEnd = body.quietHoursEnd == null ? null : String(body.quietHoursEnd);
    }
    const preferences = await upsertPreferences(auth.schoolId, auth.parentId, input);
    return res.json({ success: true, preferences });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    if (status >= 500) console.error("[parent-portal] put notification preferences", e);
    return res.status(status).json({
      success: false,
      error: status >= 500 ? "Failed to save preferences" : String(e?.message || "Failed to save preferences"),
    });
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
      messages: thread.messages.map((m) => mapThreadMessage(m, { audience: "parent" })),
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

  return { message: mapThreadMessage(msg, { audience: "parent" }), threadId: thread.id };
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

/** Authenticated parent download for message attachments in their threads only. */
router.get("/messages/:messageId/attachments/:index", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const messageId = String(req.params.messageId || "").trim();
    const index = String(req.params.index || "").trim();
    if (!messageId) return res.status(400).json({ success: false, error: "messageId required" });

    const msg = await prisma.parentTeacherMessage.findFirst({
      where: { id: messageId, schoolId: auth.schoolId },
      include: { thread: true },
    });
    if (!msg?.thread || msg.thread.parentId !== auth.parentId) {
      return res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
    }

    const att = attachmentAtIndex(msg.attachments, index);
    if (!att) return res.status(404).json({ success: false, error: "Attachment not found" });
    const base = basenameFromPrefixedUrl(att.url, "/uploads/parent-messages/");
    const abs = resolveUnderUploadDir(
      path.join(process.cwd(), "uploads/parent-messages"),
      base
    );
    if (!abs) return res.status(404).json({ success: false, error: "File missing" });

    for (const [k, v] of Object.entries(SECURE_DOWNLOAD_HEADERS)) {
      res.setHeader(k, v);
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(att.name || base || "attachment").replace(/"/g, "")}"`
    );
    if (att.mimeType) res.setHeader("Content-Type", att.mimeType);
    return res.sendFile(abs);
  } catch (e) {
    console.error("parent message attachment download", e);
    return res.status(500).json({ success: false, error: "Failed to download attachment" });
  }
});

// ——— Incidents ———

function parseParentContentPaging(query: Record<string, unknown>) {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);
  const offset = Math.min(Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0), 2000);
  return { limit, offset };
}

router.get("/homework", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const learnerId = String(req.query.learnerId || "").trim();
    const { limit, offset } = parseParentContentPaging(req.query as Record<string, unknown>);
    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    // Explicit learnerId scopes to that child; otherwise include all linked children
    // (multi-child parents previously got [] when learnerId was omitted).
    const targets = learnerId
      ? learners.filter((l) => l.id === learnerId)
      : learners;
    if (!targets.length) {
      return res.json({ success: true, homework: [], limit, offset, hasMore: false });
    }

    const membership = await loadSchoolClassMembership(auth.schoolId);
    const rows = await prisma.homeworkPost.findMany({
      where: parentHomeworkVisibilityWhere(auth.schoolId, targets, membership),
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    return res.json({
      success: true,
      homework: rows.slice(0, limit).map((h) => ({
        ...h,
        attachments: redactAttachmentUrls(h.attachments, {
          downloadBasePath: `/api/parent-portal/homework/${h.id}/attachments`,
          publicPrefix: "/uploads/teacher-app/",
        }),
      })),
      limit,
      offset,
      hasMore,
    });
  } catch (e) {
    console.error("parent homework list", e);
    return res.status(500).json({ success: false, error: "Failed to load homework" });
  }
});

/** Parent homework attachment download — visibility matches homework list targeting. */
router.get("/homework/:id/attachments/:index", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const id = String(req.params.id || "").trim();
    const index = String(req.params.index || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "id required" });

    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    const membership = await loadSchoolClassMembership(auth.schoolId);

    const post = await prisma.homeworkPost.findFirst({
      where: {
        id,
        schoolId: auth.schoolId,
        ...parentPublishedHomeworkOrNoticeWhere(),
      },
    });
    if (!post) return res.status(404).json({ success: false, error: "Not found" });

    const visible = learners.some((l) => {
      if (post.learnerId && post.learnerId === l.id) return true;
      if (post.grade && post.grade === l.grade && !post.learnerId) return true;
      if (
        post.className &&
        !post.learnerId &&
        membership.resolver.sameClassroom(post.className, l.className)
      ) {
        return true;
      }
      return false;
    });
    if (!visible) return res.status(404).json({ success: false, error: "Not found" });

    const att = attachmentAtIndex(post.attachments, index);
    if (!att) return res.status(404).json({ success: false, error: "Attachment not found" });
    const base = basenameFromPrefixedUrl(att.url, "/uploads/teacher-app/");
    const abs = resolveUnderUploadDir(path.join(process.cwd(), "uploads/teacher-app"), base);
    if (!abs) return res.status(404).json({ success: false, error: "File missing" });

    for (const [k, v] of Object.entries(SECURE_DOWNLOAD_HEADERS)) {
      res.setHeader(k, v);
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(att.name || base || "attachment").replace(/"/g, "")}"`
    );
    return res.sendFile(abs);
  } catch (e) {
    console.error("parent homework attachment", e);
    return res.status(500).json({ success: false, error: "Failed to download attachment" });
  }
});

router.get("/notices", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const learnerId = String(req.query.learnerId || "").trim();
    const cursor = String(req.query.cursor || "").trim() || null;
    const { limit, offset } = parseParentContentPaging(req.query as Record<string, unknown>);
    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    const active = learners.find((l) => l.id === learnerId) || null;
    const membership = await loadSchoolClassMembership(auth.schoolId);
    const targets = (active ? [active] : learners).map((l) => ({
      id: l.id,
      grade: String(l.grade || ""),
      className: l.className ?? null,
    }));

    // DB-level recipient targeting + bounded cursor/offset pagination (no 300-row scan).
    const page = await listParentVisibleNotices({
      schoolId: auth.schoolId,
      parentId: auth.parentId,
      learners: targets,
      spellingsFor: (cn) => membership.spellingsFor(cn),
      limit,
      offset: cursor ? 0 : offset,
      cursor,
    });

    return res.json({
      success: true,
      notices: page.notices.map((n) => ({
        ...n,
        attachments: redactAttachmentUrls((n as { attachments?: unknown }).attachments, {
          downloadBasePath: `/api/parent-portal/notices/${n.id}/attachments`,
          publicPrefix: "/uploads/teacher-app/",
        }),
      })),
      limit: page.limit,
      offset: cursor ? 0 : offset,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  } catch (e) {
    console.error("parent notices list", e);
    return res.status(500).json({ success: false, error: "Failed to load notices" });
  }
});

router.get("/notices/:id/attachments/:index", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const id = String(req.params.id || "").trim();
    const index = String(req.params.index || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "id required" });

    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    const membership = await loadSchoolClassMembership(auth.schoolId);

    const notice = await prisma.schoolNotice.findFirst({
      where: {
        id,
        schoolId: auth.schoolId,
        ...parentPublishedHomeworkOrNoticeWhere(),
      },
    });
    if (!notice) return res.status(404).json({ success: false, error: "Not found" });

    const visible = learners.some((l) =>
      learnerMatchesNotice(
        membership,
        l,
        {
          learnerId: notice.learnerId,
          grade: notice.grade,
          className: notice.className,
          audienceParentIds: notice.audienceParentIds,
        },
        auth.parentId
      )
    );
    if (!visible) return res.status(404).json({ success: false, error: "Not found" });

    const att = attachmentAtIndex(notice.attachments, index);
    if (!att) return res.status(404).json({ success: false, error: "Attachment not found" });
    const base = basenameFromPrefixedUrl(att.url, "/uploads/teacher-app/");
    const abs = resolveUnderUploadDir(path.join(process.cwd(), "uploads/teacher-app"), base);
    if (!abs) return res.status(404).json({ success: false, error: "File missing" });

    for (const [k, v] of Object.entries(SECURE_DOWNLOAD_HEADERS)) {
      res.setHeader(k, v);
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(att.name || base || "attachment").replace(/"/g, "")}"`
    );
    return res.sendFile(abs);
  } catch (e) {
    console.error("parent notice attachment", e);
    return res.status(500).json({ success: false, error: "Failed to download attachment" });
  }
});

router.get("/events", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const learnerId = String(req.query.learnerId || "").trim();
    const cursor = String(req.query.cursor || "").trim() || null;
    const rangeRaw = String(req.query.range || "upcoming").trim().toLowerCase();
    const range =
      rangeRaw === "past" || rangeRaw === "all" || rangeRaw === "upcoming" ? rangeRaw : "upcoming";
    const { limit } = parseParentContentPaging(req.query as Record<string, unknown>);
    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    // Combined calendar for all linked children unless a specific learner filter is requested.
    const scope = learnerId ? learners.filter((l) => l.id === learnerId) : learners;
    const membership = await loadSchoolClassMembership(auth.schoolId);
    const page = await listParentVisibleEvents({
      schoolId: auth.schoolId,
      learners: scope.map((l) => ({
        id: l.id,
        grade: String(l.grade || ""),
        className: l.className ?? null,
        firstName: l.firstName,
        lastName: l.lastName,
      })),
      spellingsFor: (cn) => membership.spellingsFor(cn),
      limit,
      cursor,
      range,
    });
    return res.json({
      success: true,
      events: page.events,
      limit: page.limit,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      range,
    });
  } catch (e) {
    console.error("parent events list", e);
    return res.status(500).json({ success: false, error: "Failed to load events" });
  }
});

router.get("/documents", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const learnerId = String(req.query.learnerId || "").trim();
    const { limit, offset } = parseParentContentPaging(req.query as Record<string, unknown>);
    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    const active = learners.find((l) => l.id === learnerId) || null;
    const membership = await loadSchoolClassMembership(auth.schoolId);

    const where = buildParentDocumentVisibilityWhere({
      schoolId: auth.schoolId,
      learners,
      activeLearnerId: active?.id || null,
      spellingsFor: (cn) => membership.spellingsFor(cn),
    });

    const [page, total] = await Promise.all([
      prisma.parentDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.parentDocument.count({ where }),
    ]);

    return res.json({
      success: true,
      documents: page.map((d) => publicParentDocumentDto(d, { audience: "parent" })),
      limit,
      offset,
      total,
      hasMore: offset + limit < total,
    });
  } catch (e) {
    console.error("parent documents list", e);
    return res.status(500).json({ success: false, error: "Failed to load documents" });
  }
});

/** Authenticated parent download — visibility enforced; no public static URL. */
router.get("/documents/:id/file", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "id required" });

    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    const membership = await loadSchoolClassMembership(auth.schoolId);
    const where = buildParentDocumentVisibilityWhere({
      schoolId: auth.schoolId,
      learners,
      spellingsFor: (cn) => membership.spellingsFor(cn),
    });

    const doc = await prisma.parentDocument.findFirst({
      where: { ...where, id },
    });
    if (!doc) {
      return res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
    }

    const base = basenameFromTeacherAppFileUrl(doc.fileUrl);
    const abs = resolveTeacherAppAbsolutePath(base);
    if (!abs) {
      return res.status(404).json({ success: false, error: "File missing" });
    }

    for (const [k, v] of Object.entries(SECURE_DOWNLOAD_HEADERS)) {
      res.setHeader(k, v);
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(doc.fileName || base || "document").replace(/"/g, "")}"`
    );
    return res.sendFile(abs);
  } catch (e) {
    console.error("parent document download", e);
    return res.status(500).json({ success: false, error: "Failed to download document" });
  }
});

router.get("/incidents", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const learnerId = String(req.query.learnerId || "").trim();
    const { limit, offset } = parseParentContentPaging(req.query as Record<string, unknown>);
    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent) return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    const active =
      learners.find((l) => l.id === learnerId) || (learners.length === 1 ? learners[0] : null);
    if (!active) return res.json({ success: true, incidents: [], limit, offset, hasMore: false });

    const rows = await prisma.learnerIncident.findMany({
      where: {
        schoolId: auth.schoolId,
        learnerId: active.id,
        ...parentPublishedIncidentWhere(),
      },
      orderBy: { incidentDate: "desc" },
      skip: offset,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    return res.json({
      success: true,
      incidents: rows.slice(0, limit),
      limit,
      offset,
      hasMore,
    });
  } catch (e) {
    console.error("parent incidents list", e);
    return res.status(500).json({ success: false, error: "Failed to load incidents" });
  }
});

router.get("/incidents/:id", parentAuthMiddleware, async (req, res) => {
  try {
    const auth = (req as any).parentAuth;
    const incident = await prisma.learnerIncident.findFirst({
      where: {
        id: String(req.params.id),
        schoolId: auth.schoolId,
        ...parentPublishedIncidentWhere(),
      },
      include: { learner: true },
    });
    if (!incident) return res.status(404).json({ success: false, error: "Incident not found" });

    const link = await prisma.parentLearnerLink.findFirst({
      where: {
        parentId: auth.parentId,
        learnerId: incident.learnerId,
        schoolId: auth.schoolId,
      },
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
    if (!(await requireSameSchoolStaff(req, res, schoolId))) return;
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
    if (!(await requireSameSchoolStaff(req, res, schoolId))) return;
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
    if (!(await requireSameSchoolStaff(req, res, schoolId))) return;
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
      const links = uniqueParentLearnerLinks(
        await prisma.parentLearnerLink.findMany({
          where: {
            schoolId,
            learner: {
              ...(post.grade ? { grade: post.grade } : {}),
              ...(post.className
                ? {
                    className: {
                      in: (await loadSchoolClassMembership(schoolId)).spellingsFor(post.className),
                    },
                  }
                : {}),
            },
          },
          select: { parentId: true, learnerId: true },
        })
      );
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
    if (!(await requireSchoolWideNoticePublisher(req, res, schoolId))) return;
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
        lifecycleStatus: "PUBLISHED",
        isDraft: false,
        publishedAt: new Date(),
      },
    });

    await prisma.schoolNoticeAuditLog.create({
      data: {
        schoolId,
        noticeId: notice.id,
        actorEmail: String(req.body?.createdBy || ""),
        action: "CREATE_AND_PUBLISH",
        previousLifecycle: null,
        newLifecycle: "PUBLISHED",
        newTargeting: {
          grade: notice.grade,
          className: notice.className,
          learnerId: notice.learnerId,
        },
      },
    }).catch((err) => console.warn("staff notice audit", err));

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

    const membership = await loadSchoolClassMembership(schoolId);
    const matched = uniqueParentLearnerLinks(
      links.filter((link) => learnerMatchesNotice(membership, link.learner, notice))
    );
    for (const link of matched) {
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
    const gate = await resolveStaffSchoolGate(req.headers.authorization);
    if (!gate) {
      sendAuthRequired(res);
      return;
    }
    if (!allowSchool(gate, schoolId, res)) return;

    const title = String(req.body?.title || "").trim();
    const rawFileUrl = String(req.body?.fileUrl || "").trim();
    if (!schoolId || !title || !rawFileUrl) {
      return res.status(400).json({ success: false, error: "schoolId, title and fileUrl required" });
    }
    // Accept legacy absolute URLs but store via internal relative path — never trust client paths.
    const storedBase = basenameFromTeacherAppFileUrl(rawFileUrl);
    if (!storedBase) {
      return res.status(400).json({
        success: false,
        error: "fileUrl must reference a teacher-app upload",
        code: "INVALID_FILE",
      });
    }
    const fileUrl = internalTeacherAppFileUrl(storedBase);

    const grade = req.body?.grade ? String(req.body.grade).trim() : null;
    const className = req.body?.className ? String(req.body.className).trim() : null;
    const learnerId = req.body?.learnerId ? String(req.body.learnerId).trim() : null;
    const schoolWide = !grade && !className && !learnerId;
    const isAdmin = isSchoolWideNoticePublisherRole({
      superAdmin: gate.superAdmin,
      appRole: gate.auth.appRole,
      role: gate.auth.role,
    });

    if (!isAdmin) {
      if (schoolWide || grade || learnerId) {
        return res.status(403).json({
          success: false,
          error: "Teachers may only upload documents for their assigned classes",
          code: "TARGETING_DENIED",
        });
      }
      const classroomIds = await assignedClassroomIdsForTeacher(
        schoolId,
        gate.auth.userId,
        gate.auth.email
      );
      const classrooms = await prisma.classroom.findMany({
        where: { schoolId, id: { in: classroomIds } },
        select: { name: true },
      });
      const byEmail = await prisma.classroom.findMany({
        where: {
          schoolId,
          teacherEmail: {
            equals: normalizeStaffEmail(gate.auth.email),
            mode: "insensitive",
          },
        },
        select: { name: true },
      });
      const assigned = new Set(
        [...classrooms, ...byEmail].map((c) => String(c.name || "").trim()).filter(Boolean)
      );
      if (!className || !assigned.has(className)) {
        return res.status(403).json({
          success: false,
          error: "Class not in your assigned classrooms",
          code: "CLASS_DENIED",
        });
      }
    }

    const doc = await prisma.parentDocument.create({
      data: {
        schoolId,
        title,
        description: req.body?.description || null,
        grade,
        className,
        learnerId,
        fileUrl,
        fileName: String(req.body?.fileName || ""),
        createdBy: gate.auth.email || "",
        createdByTeacherId: gate.auth.userId,
      },
    });

    const links = await prisma.parentLearnerLink.findMany({
      where: { schoolId },
      include: { learner: true },
    });
    const docMembership = await loadSchoolClassMembership(schoolId);
    const matched = uniqueParentLearnerLinks(
      links.filter((link) =>
        learnerMatchesNotice(docMembership, link.learner, {
          learnerId: doc.learnerId,
          grade: doc.grade,
          className: doc.className,
        })
      )
    );
    for (const link of matched) {
      await createParentNotification({
        schoolId,
        parentId: link.parentId,
        learnerId: link.learnerId,
        type: "DOCUMENT",
        title: "New document",
        message: title,
        metadata: { documentId: doc.id },
      });
    }

    return res.json({
      success: true,
      document: publicParentDocumentDto(doc, { audience: "staff", schoolId }),
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to upload document" });
  }
});

router.post("/notify-invoice-run", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!(await requireSameSchoolStaff(req, res, schoolId))) return;
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
    if (!(await requireSameSchoolStaff(req, res, schoolId))) return;
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const result = await runMigrationParentOnboarding(schoolId);
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("migration onboarding", e);
    return res.status(500).json({ success: false, error: "Failed to run parent onboarding" });
  }
});

// Legacy lookup (cell + optional id). Rate-limited per IP. Not staff-JWT gated.
router.get("/lookup-by-cell", rateLimitParentPortalLookup, async (req, res) => {
  try {
    const result = await lookupParentPortalBySchool({
      schoolId: String(req.query.schoolId || "").trim(),
      cellNo: String(req.query.cellNo || "").trim(),
      idNumber: String(req.query.idNumber || "").trim(),
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.module ? { module: result.module } : {}),
      });
    }
    return res.json({
      success: true,
      parent: result.parent,
      learners: result.learners,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Lookup failed" });
  }
});

export default router;
