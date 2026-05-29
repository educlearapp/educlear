"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const parentPortalService_1 = require("../services/parentPortalService");
const parentAuth_1 = require("../middleware/parentAuth");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const statementEmailService_1 = require("../services/statementEmailService");
const schoolEmailService_1 = require("../services/schoolEmailService");
const statementPdfData_1 = require("../services/statementPdfData");
const router = (0, express_1.Router)();
const otpStore = new Map();
function otpKey(schoolId, idNumber) {
    return `${schoolId}:${idNumber}`;
}
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
async function parentWithLearners(parentId, schoolId) {
    return prisma_1.prisma.parent.findFirst({
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
function resolveParentFamilyBillingScope(learners, anchorLearnerId) {
    const anchor = learners.find((l) => l.id === anchorLearnerId) || (learners.length === 1 ? learners[0] : null);
    if (!anchor) {
        return { accountRef: "", learnerIds: [], learners: [] };
    }
    const familyId = String(anchor.familyAccountId || anchor.familyAccount?.id || "").trim();
    const accountRef = (0, learnerIdentity_1.resolveLearnerAccountNo)(anchor);
    let group = [anchor];
    if (familyId) {
        group = learners.filter((l) => String(l.familyAccountId || l.familyAccount?.id || "") === familyId);
    }
    else if (accountRef) {
        group = learners.filter((l) => (0, learnerIdentity_1.resolveLearnerAccountNo)(l) === accountRef);
    }
    return {
        accountRef,
        learnerIds: group.map((l) => l.id),
        learners: group,
    };
}
function resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef) {
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
function learnerMatchesNotice(learner, notice) {
    if (notice.learnerId && notice.learnerId === learner.id)
        return true;
    if (notice.grade && notice.grade === learner.grade)
        return true;
    if (notice.className && notice.className === String(learner.className || ""))
        return true;
    if (!notice.learnerId && !notice.grade && !notice.className)
        return true;
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
        const parent = await (0, parentPortalService_1.findParentByCredentials)({ schoolId, idNumber, cellNo });
        if (!parent) {
            return res.status(404).json({ success: false, error: "Parent not found for this school" });
        }
        const code = generateOtp();
        otpStore.set(otpKey(schoolId, idNumber), {
            code,
            expiresAt: Date.now() + 10 * 60 * 1000,
        });
        const devMode = process.env.NODE_ENV !== "production";
        return res.json({
            success: true,
            message: "OTP sent (dev: check response if enabled)",
            ...(devMode ? { devOtp: code } : {}),
        });
    }
    catch (e) {
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
        const record = otpStore.get(otpKey(schoolId, idNumber));
        const devBypass = code === "000000" && process.env.NODE_ENV !== "production";
        if (!devBypass) {
            if (!record || record.expiresAt < Date.now() || record.code !== code) {
                return res.status(401).json({ success: false, error: "Invalid or expired OTP" });
            }
            otpStore.delete(otpKey(schoolId, idNumber));
        }
        const parent = await (0, parentPortalService_1.findParentByCredentials)({ schoolId, idNumber, cellNo });
        if (!parent) {
            return res.status(404).json({ success: false, error: "Parent not found" });
        }
        await prisma_1.prisma.parentOnboarding.upsert({
            where: { parentId: parent.id },
            create: { schoolId, parentId: parent.id, status: "REGISTERED", registeredAt: new Date() },
            update: { status: "REGISTERED", registeredAt: new Date() },
        });
        const token = (0, parentAuth_1.signParentToken)({
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
    }
    catch (e) {
        console.error("verify-otp", e);
        return res.status(500).json({ success: false, error: "Failed to verify OTP" });
    }
});
router.get("/me", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
        const parent = await parentWithLearners(auth.parentId, auth.schoolId);
        if (!parent)
            return res.status(404).json({ success: false, error: "Parent not found" });
        await prisma_1.prisma.parentOnboarding.updateMany({
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
    }
    catch (e) {
        console.error("parent me", e);
        return res.status(500).json({ success: false, error: "Failed to load profile" });
    }
});
router.get("/dashboard", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
        const learnerId = String(req.query.learnerId || "").trim();
        const parent = await parentWithLearners(auth.parentId, auth.schoolId);
        if (!parent)
            return res.status(404).json({ success: false, error: "Parent not found" });
        const learners = parent.links.map((l) => l.learner);
        const activeLearner = learners.find((l) => l.id === learnerId) || (learners.length === 1 ? learners[0] : null);
        const learnerIds = learners.map((l) => l.id);
        const [notifications, unreadMessages, incidents, homework, notices, documents] = await Promise.all([
            prisma_1.prisma.parentNotification.findMany({
                where: { parentId: auth.parentId, schoolId: auth.schoolId },
                orderBy: { createdAt: "desc" },
                take: 30,
            }),
            prisma_1.prisma.parentTeacherMessage.count({
                where: {
                    thread: { parentId: auth.parentId, schoolId: auth.schoolId },
                    senderType: { in: ["TEACHER", "ADMIN"] },
                    isRead: false,
                },
            }),
            activeLearner
                ? prisma_1.prisma.learnerIncident.findMany({
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
                ? prisma_1.prisma.homeworkPost.findMany({
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
            prisma_1.prisma.schoolNotice.findMany({
                where: { schoolId: auth.schoolId },
                orderBy: { publishedAt: "desc" },
                take: 50,
            }),
            prisma_1.prisma.parentDocument.findMany({
                where: { schoolId: auth.schoolId },
                orderBy: { createdAt: "desc" },
                take: 30,
            }),
        ]);
        const latestInvoice = notifications.find((n) => n.type === "INVOICE_READY") || null;
        const filteredNotices = activeLearner
            ? notices.filter((n) => learnerMatchesNotice(activeLearner, n))
            : notices.filter((n) => learners.some((l) => learnerMatchesNotice(l, n)));
        const filteredDocs = activeLearner
            ? documents.filter((d) => (!d.learnerId && !d.grade && !d.className) ||
                d.learnerId === activeLearner.id ||
                d.grade === activeLearner.grade ||
                d.className === activeLearner.className)
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
    }
    catch (e) {
        console.error("dashboard", e);
        return res.status(500).json({ success: false, error: "Failed to load dashboard" });
    }
});
router.get("/billing", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
        const learnerId = String(req.query.learnerId || "").trim();
        const parent = await parentWithLearners(auth.parentId, auth.schoolId);
        if (!parent)
            return res.status(404).json({ success: false, error: "Parent not found" });
        const learners = parent.links.map((l) => l.learner);
        const anchorId = learnerId || learners[0]?.id || "";
        const scope = resolveParentFamilyBillingScope(learners, anchorId);
        const ledger = (0, billingLedgerStore_1.readSchoolLedger)(auth.schoolId);
        const entries = (0, billingLedgerStore_1.collectFamilyAccountEntries)(ledger, {
            accountRef: scope.accountRef,
            learnerIds: scope.learnerIds,
        });
        const balance = (0, billingLedgerStore_1.calculateBalanceFromEntries)(entries);
        const nameByLearnerId = new Map(scope.learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()]));
        const sorted = [...entries].sort((a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime());
        let running = 0;
        const transactions = sorted.map((entry, index) => {
            const amount = Number(entry.amount) || 0;
            const isDebit = entry.type === "invoice" || entry.type === "penalty";
            running += isDebit ? amount : -amount;
            const typeLabel = entry.type === "invoice"
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
        const familyAccountId = String(scope.learners[0]?.familyAccountId || scope.learners[0]?.familyAccount?.id || "").trim();
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
    }
    catch (e) {
        console.error("parent billing", e);
        return res.status(500).json({ success: false, error: "Failed to load billing" });
    }
});
async function serveParentStatementPdf(req, res) {
    const auth = req.parentAuth;
    if (!auth?.parentId || !auth?.schoolId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const learnerId = String(req.query?.learnerId || "").trim();
    if (!learnerId) {
        return res.status(400).json({ success: false, error: "Missing learnerId" });
    }
    const parent = await parentWithLearners(auth.parentId, auth.schoolId);
    if (!parent)
        return res.status(404).json({ success: false, error: "Parent not found" });
    const learners = parent.links.map((l) => l.learner);
    const scope = resolveParentFamilyBillingScope(learners, learnerId);
    if (!scope.learnerIds.length) {
        return res.status(403).json({ success: false, error: "Learner not linked to this account" });
    }
    console.log("[PDF] generating", learnerId, { schoolId: auth.schoolId, parentId: auth.parentId });
    const { buffer, filename } = await (0, statementPdfData_1.buildAndGenerateStatementPdf)({
        schoolId: auth.schoolId,
        learnerId,
        period: "All Time",
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    return res.send(buffer);
}
// GET /api/parent-portal/billing/statement.pdf | statement-pdf
router.get("/billing/statement.pdf", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        return await serveParentStatementPdf(req, res);
    }
    catch (error) {
        console.error("[parent-portal] GET billing/statement.pdf failed:", error);
        const err = error;
        return res.status(500).json({
            success: false,
            error: err.message || "Failed to generate statement PDF",
        });
    }
});
router.get("/billing/statement-pdf", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        return await serveParentStatementPdf(req, res);
    }
    catch (error) {
        console.error("[parent-portal] GET billing/statement-pdf failed:", error);
        const err = error;
        return res.status(500).json({
            success: false,
            error: err.message || "Failed to generate statement PDF",
        });
    }
});
router.post("/billing/email-statement", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
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
        if (!parent)
            return res.status(404).json({ success: false, error: "Parent not found" });
        const learners = parent.links.map((l) => l.learner);
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
        const result = await (0, statementEmailService_1.sendStatementEmail)({
            schoolId: auth.schoolId,
            to,
            subject,
            html,
            learnerId,
            period: "All Time",
        });
        return res.json({ success: true, messageId: result.messageId });
    }
    catch (error) {
        console.error("parent billing email-statement", error);
        const err = error;
        if (err.setupRequired) {
            return res.status(409).json((0, schoolEmailService_1.buildSetupRequiredPayload)());
        }
        return res.status(500).json({
            success: false,
            error: err.message || "Failed to email statement",
        });
    }
});
router.get("/notifications", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
        const items = await prisma_1.prisma.parentNotification.findMany({
            where: { parentId: auth.parentId, schoolId: auth.schoolId },
            include: {
                learner: { select: { id: true, firstName: true, lastName: true, grade: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 200,
        });
        return res.json({ success: true, notifications: items });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to load notifications" });
    }
});
router.patch("/notifications/:id/read", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
        const id = String(req.params.id);
        const item = await prisma_1.prisma.parentNotification.updateMany({
            where: { id, parentId: auth.parentId, schoolId: auth.schoolId },
            data: { isRead: true, readAt: new Date() },
        });
        return res.json({ success: true, updated: item.count });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to mark read" });
    }
});
router.patch("/notifications/read-all", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
        await prisma_1.prisma.parentNotification.updateMany({
            where: { parentId: auth.parentId, schoolId: auth.schoolId, isRead: false },
            data: { isRead: true, readAt: new Date() },
        });
        return res.json({ success: true });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to mark all read" });
    }
});
// ——— Messaging ———
async function loadThreadForParent(opts) {
    const link = await prisma_1.prisma.parentLearnerLink.findFirst({
        where: { parentId: opts.parentId, learnerId: opts.learnerId, schoolId: opts.schoolId },
    });
    if (!link)
        return { error: "Learner not linked to this parent", status: 403 };
    const { thread, classroom, learner } = await (0, parentPortalService_1.getOrCreateThread)({
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        learnerId: opts.learnerId,
    });
    if (opts.markTeacherRead) {
        await prisma_1.prisma.parentTeacherMessage.updateMany({
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
            messages: thread.messages.map(parentPortalService_1.mapThreadMessage),
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
            const auth = (0, parentAuth_1.verifyParentToken)(bearer);
            if (!auth)
                return res.status(401).json({ success: false, error: "Invalid session" });
            if (!learnerId)
                return res.status(400).json({ success: false, error: "learnerId required" });
            const data = await loadThreadForParent({
                schoolId: auth.schoolId,
                parentId: auth.parentId,
                learnerId,
                markTeacherRead: true,
            });
            if ("error" in data)
                return res.status(data.status ?? 403).json({ success: false, error: data.error });
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
        const parent = await (0, parentPortalService_1.findParentByCredentials)({ schoolId, cellNo, idNumber });
        if (!parent)
            return res.status(404).json({ success: false, error: "Parent not found" });
        const data = await loadThreadForParent({
            schoolId,
            parentId: parent.id,
            learnerId,
            markTeacherRead: true,
        });
        if ("error" in data)
            return res.status(data.status ?? 403).json({ success: false, error: data.error });
        return res.json({ success: true, ...data });
    }
    catch (e) {
        console.error("thread", e);
        return res.status(500).json({ success: false, error: "Failed to load thread" });
    }
});
async function sendParentMessage(opts) {
    const parent = await prisma_1.prisma.parent.findFirst({
        where: { id: opts.parentId, schoolId: opts.schoolId },
    });
    if (!parent)
        return { error: "Parent not found", status: 404 };
    const link = await prisma_1.prisma.parentLearnerLink.findFirst({
        where: { parentId: opts.parentId, learnerId: opts.learnerId, schoolId: opts.schoolId },
    });
    if (!link)
        return { error: "Learner not linked to this parent", status: 403 };
    const { thread, classroom, learner } = await (0, parentPortalService_1.getOrCreateThread)({
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        learnerId: opts.learnerId,
    });
    const debug = await (0, parentPortalService_1.debugParentThreadResolution)({
        schoolId: opts.schoolId,
        learnerId: opts.learnerId,
        parentId: opts.parentId,
    });
    if (debug) {
        (0, parentPortalService_1.logParentThreadResolution)("parent-send-message", debug);
    }
    else {
        console.log("[parent-thread] parent-send-message", {
            learnerId: opts.learnerId,
            learnerClassName: learner.className,
            matchedClassroomId: classroom?.id,
            matchedClassroomName: classroom?.name,
            classroomTeacherEmail: classroom?.teacherEmail,
            threadTeacherEmail: thread.teacherEmail,
        });
    }
    const msg = await prisma_1.prisma.parentTeacherMessage.create({
        data: {
            threadId: thread.id,
            schoolId: opts.schoolId,
            senderType: "PARENT",
            senderName: `${parent.firstName} ${parent.surname}`.trim(),
            body: opts.body,
            attachments: opts.attachments || undefined,
        },
    });
    await prisma_1.prisma.parentTeacherThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
    });
    return { message: (0, parentPortalService_1.mapThreadMessage)(msg), threadId: thread.id };
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
            const auth = (0, parentAuth_1.verifyParentToken)(bearer);
            if (!auth)
                return res.status(401).json({ success: false, error: "Invalid session" });
            schoolId = auth.schoolId;
            parentId = auth.parentId;
        }
        else {
            const cellNo = String(req.body?.cellNo || "").trim();
            const idNumber = String(req.body?.idNumber || "").trim();
            if (!schoolId || !cellNo || !idNumber) {
                return res.status(400).json({
                    success: false,
                    error: "schoolId, cellNo and idNumber are required",
                });
            }
            const parent = await (0, parentPortalService_1.findParentByCredentials)({ schoolId, cellNo, idNumber });
            if (!parent)
                return res.status(404).json({ success: false, error: "Parent not found" });
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
    }
    catch (e) {
        console.error("send-message", e);
        return res.status(500).json({ success: false, error: "Failed to send message" });
    }
});
// ——— Incidents ———
router.get("/incidents/:id", parentAuth_1.parentAuthMiddleware, async (req, res) => {
    try {
        const auth = req.parentAuth;
        const incident = await prisma_1.prisma.learnerIncident.findFirst({
            where: {
                id: String(req.params.id),
                schoolId: auth.schoolId,
                parentVisible: true,
            },
            include: { learner: true },
        });
        if (!incident)
            return res.status(404).json({ success: false, error: "Incident not found" });
        const link = await prisma_1.prisma.parentLearnerLink.findFirst({
            where: { parentId: auth.parentId, learnerId: incident.learnerId },
        });
        if (!link)
            return res.status(403).json({ success: false, error: "Access denied" });
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
    }
    catch (e) {
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
        const incident = await prisma_1.prisma.learnerIncident.create({
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
            await (0, parentPortalService_1.notifyParentsForLearner)({
                schoolId,
                learnerId,
                type: "INCIDENT",
                title: "Incident recorded",
                message: `An incident was recorded for your child: ${incident.subject}`,
                metadata: { incidentId: incident.id },
            });
        }
        return res.json({ success: true, incident });
    }
    catch (e) {
        console.error("create incident", e);
        return res.status(500).json({ success: false, error: "Failed to save incident" });
    }
});
router.get("/staff/incidents", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "schoolId required" });
        const incidents = await prisma_1.prisma.learnerIncident.findMany({
            where: { schoolId },
            include: { learner: { select: { id: true, firstName: true, lastName: true, grade: true, className: true } } },
            orderBy: { incidentDate: "desc" },
        });
        return res.json({ success: true, incidents });
    }
    catch (e) {
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
        const post = await prisma_1.prisma.homeworkPost.create({
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
            await (0, parentPortalService_1.notifyParentsForLearner)({
                schoolId,
                learnerId: post.learnerId,
                type: "HOMEWORK",
                title: "Homework uploaded",
                message: title,
                metadata: { homeworkId: post.id },
            });
        }
        else {
            const links = await prisma_1.prisma.parentLearnerLink.findMany({
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
                await (0, parentPortalService_1.createParentNotification)({
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
    }
    catch (e) {
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
        const notice = await prisma_1.prisma.schoolNotice.create({
            data: {
                schoolId,
                noticeType: noticeType,
                title,
                body: String(req.body?.body || ""),
                grade: req.body?.grade || null,
                className: req.body?.className || null,
                learnerId: req.body?.learnerId || null,
                attachments: req.body?.attachments || undefined,
                createdBy: String(req.body?.createdBy || ""),
            },
        });
        const notifType = noticeType === "ASSESSMENT"
            ? "ASSESSMENT"
            : noticeType === "EXAM"
                ? "EXAM"
                : "SCHOOL_NOTICE";
        const links = await prisma_1.prisma.parentLearnerLink.findMany({
            where: { schoolId },
            include: { learner: true },
        });
        for (const link of links) {
            if (!learnerMatchesNotice(link.learner, notice))
                continue;
            await (0, parentPortalService_1.createParentNotification)({
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
    }
    catch (e) {
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
        const doc = await prisma_1.prisma.parentDocument.create({
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
        const links = await prisma_1.prisma.parentLearnerLink.findMany({
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
            await (0, parentPortalService_1.createParentNotification)({
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
    }
    catch (e) {
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
        const count = await (0, parentPortalService_1.notifyParentsInvoiceRun)({ schoolId, month, runId, learnerIds });
        return res.json({ success: true, parentsNotified: count });
    }
    catch (e) {
        console.error("notify-invoice-run", e);
        return res.status(500).json({ success: false, error: "Failed to notify parents" });
    }
});
router.post("/migration/onboarding", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "schoolId required" });
        const result = await (0, parentPortalService_1.runMigrationParentOnboarding)(schoolId);
        return res.json({ success: true, ...result });
    }
    catch (e) {
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
        const parent = await (0, parentPortalService_1.findParentByCredentials)({ schoolId, cellNo: rawCellNo, idNumber });
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
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Lookup failed" });
    }
});
exports.default = router;
